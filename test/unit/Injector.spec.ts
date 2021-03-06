import { expect } from 'chai';
import { Injector } from '../../src/api/Injector';
import { tokens } from '../../src/tokens';
import { rootInjector } from '../../src/InjectorImpl';
import { TARGET_TOKEN, INJECTOR_TOKEN } from '../../src/api/InjectionToken';
import { Exception } from '../../src/Exception';
import { Scope } from '../../src/api/Scope';
import * as sinon from 'sinon';
import { Disposable } from '../../src/api/Disposable';
import { Task, tick } from '../helpers/Task';

describe('InjectorImpl', () => {
  describe('AbstractInjector', () => {
    it('should be able to inject injector and target in a class', () => {
      // Arrange
      class Injectable {
        constructor(
          public readonly target: Function | undefined,
          public readonly injector: Injector<{}>
        ) {}
        public static inject = tokens(TARGET_TOKEN, INJECTOR_TOKEN);
      }

      // Act
      const actual = rootInjector.injectClass(Injectable);

      // Assert
      expect(actual.target).undefined;
      expect(actual.injector).eq(rootInjector);
    });

    it('should be able to inject injector and target in a function', () => {
      // Arrange
      let actualTarget: Function | undefined;
      let actualInjector: Injector<{}> | undefined;
      const expectedResult = { result: 42 };
      function injectable(t: Function | undefined, i: Injector<{}>) {
        actualTarget = t;
        actualInjector = i;
        return expectedResult;
      }
      injectable.inject = tokens(TARGET_TOKEN, INJECTOR_TOKEN);

      // Act
      const actualResult: { result: number } = rootInjector.injectFunction(
        injectable
      );

      // Assert
      expect(actualTarget).undefined;
      expect(actualInjector).eq(rootInjector);
      expect(actualResult).eq(expectedResult);
    });

    it('should be able to provide a target into a function', () => {
      // Arrange
      function fooFactory(target: undefined | Function) {
        return `foo -> ${target && target.name}`;
      }
      fooFactory.inject = tokens(TARGET_TOKEN);
      function barFactory(target: undefined | Function, fooName: string) {
        return `${fooName} -> bar -> ${target && target.name}`;
      }
      barFactory.inject = tokens(TARGET_TOKEN, 'fooName');
      class Foo {
        constructor(public name: string) {}
        public static inject = tokens('name');
      }

      // Act
      const actualFoo = rootInjector
        .provideFactory('fooName', fooFactory)
        .provideFactory('name', barFactory)
        .injectClass(Foo);

      // Assert
      expect(actualFoo.name).eq('foo -> barFactory -> bar -> Foo');
    });

    it('should be able to provide a target into a class', () => {
      // Arrange
      class Foo {
        constructor(public target: undefined | Function) {}
        public static inject = tokens(TARGET_TOKEN);
      }
      class Bar {
        constructor(public target: undefined | Function, public foo: Foo) {}
        public static inject = tokens(TARGET_TOKEN, 'foo');
      }

      class Baz {
        constructor(public bar: Bar, public target: Function | undefined) {}
        public static inject = tokens('bar', TARGET_TOKEN);
      }

      // Act
      const actualBaz = rootInjector
        .provideClass('foo', Foo)
        .provideClass('bar', Bar)
        .injectClass(Baz);

      // Assert
      expect(actualBaz.target).undefined;
      expect(actualBaz.bar.target).eq(Baz);
      expect(actualBaz.bar.foo.target).eq(Bar);
    });

    it('should throw when no provider was found for a class', () => {
      class FooInjectable {
        constructor(public foo: string) {}
        public static inject = tokens('foo');
      }
      expect(() => rootInjector.injectClass(FooInjectable as any)).throws(
        Exception,
        'Could not inject "FooInjectable". Inner error: No provider found for "foo"!'
      );
    });

    it('should throw when no provider was found for a function', () => {
      function foo(bar: string) {
        return bar;
      }
      foo.inject = ['bar'];
      expect(() => rootInjector.injectFunction(foo as any)).throws(
        Exception,
        'Could not inject "foo". Inner error: No provider found for "bar"!'
      );
    });

    it('should be able to provide an Injector for a partial context', () => {
      class Foo {
        constructor(public injector: Injector<{ bar: number }>) {}
        public static inject = tokens(INJECTOR_TOKEN);
      }
      const barBazInjector = rootInjector
        .provideValue('bar', 42)
        .provideValue('baz', 'qux');
      const actualFoo = barBazInjector.injectClass(Foo);
      expect(actualFoo.injector).eq(barBazInjector);
    });
  });

  describe('ChildInjector', () => {
    it('should cache the value if scope = Singleton', () => {
      // Arrange
      let n = 0;
      function count() {
        return n++;
      }
      count.inject = tokens();
      const countInjector = rootInjector.provideFactory('count', count);
      class Injectable {
        constructor(public count: number) {}
        public static inject = tokens('count');
      }

      // Act
      const first = countInjector.injectClass(Injectable);
      const second = countInjector.injectClass(Injectable);

      // Assert
      expect(first.count).eq(second.count);
    });

    it('should _not_ cache the value if scope = Transient', () => {
      // Arrange
      let n = 0;
      function count() {
        return n++;
      }
      count.inject = tokens();
      const countInjector = rootInjector.provideFactory(
        'count',
        count,
        Scope.Transient
      );
      class Injectable {
        constructor(public count: number) {}
        public static inject = tokens('count');
      }

      // Act
      const first = countInjector.injectClass(Injectable);
      const second = countInjector.injectClass(Injectable);

      // Assert
      expect(first.count).eq(0);
      expect(second.count).eq(1);
    });
  });

  describe('ValueProvider', () => {
    it('should be able to provide a value', () => {
      const sut = rootInjector.provideValue('foo', 42);
      const actual = sut.injectClass(
        class {
          constructor(public foo: number) {}
          public static inject = tokens('foo');
        }
      );
      expect(actual.foo).eq(42);
    });
    it('should be able to provide a value from the parent injector', () => {
      const sut = rootInjector
        .provideValue('foo', 42)
        .provideValue('bar', 'baz');
      expect(sut.resolve('bar')).eq('baz');
      expect(sut.resolve('foo')).eq(42);
    });
    it('should throw after disposed', () => {
      const sut = rootInjector.provideValue('foo', 42);
      sut.dispose();
      expect(() => sut.resolve('foo')).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to resolve "foo".'
      );
      expect(() => sut.injectClass(class Bar {})).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to inject "Bar".'
      );
      expect(() => sut.injectFunction(function baz() {})).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to inject "baz".'
      );
    });
  });

  describe('FactoryProvider', () => {
    it('should be able to provide the return value of the factoryMethod', () => {
      const expectedValue = { foo: 'bar' };
      function foobar() {
        return expectedValue;
      }

      const actual = rootInjector.provideFactory('foobar', foobar).injectClass(
        class {
          constructor(public foobar: { foo: string }) {}
          public static inject = tokens('foobar');
        }
      );
      expect(actual.foobar).eq(expectedValue);
    });

    it('should be able to provide parent injector values', () => {
      function answer() {
        return 42;
      }
      const factoryProvider = rootInjector.provideFactory('answer', answer);
      const actual = factoryProvider.injectClass(
        class {
          constructor(
            public injector: Injector<{ answer: number }>,
            public answer: number
          ) {}
          public static inject = tokens(INJECTOR_TOKEN, 'answer');
        }
      );
      expect(actual.injector).eq(factoryProvider);
      expect(actual.answer).eq(42);
    });

    it('should throw after disposed', () => {
      const sut = rootInjector.provideFactory('answer', function answer() {
        return 42;
      });
      sut.dispose();
      expect(() => sut.resolve('answer')).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to resolve "answer".'
      );
      expect(() => sut.injectClass(class Bar {})).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to inject "Bar".'
      );
      expect(() => sut.injectFunction(function baz() {})).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to inject "baz".'
      );
    });

    it('should be able to decorate an existing token', () => {
      function incrementDecorator(n: number) {
        return ++n;
      }
      incrementDecorator.inject = tokens('answer');

      const answerProvider = rootInjector
        .provideValue('answer', 40)
        .provideFactory('answer2', incrementDecorator);

      expect(answerProvider.resolve('answer2')).eq(41);
    });

    it('should not be able to change the type of a token', () => {
      expect(function(){
        const answerProvider = rootInjector
          .provideValue('answer', 42)
          .provideValue('answer', '42');
        answerProvider.resolve('answer');
      }).to.throw('Token: answer is already used on this injector.');
    });
  });

  describe('ClassProvider', () => {
    it('should throw after disposed', () => {
      const sut = rootInjector.provideClass('foo', class Foo {});
      sut.dispose();
      expect(() => sut.resolve('foo')).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to resolve "foo".'
      );
      expect(() => sut.injectClass(class Bar {})).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to inject "Bar".'
      );
      expect(() => sut.injectFunction(function baz() {})).throws(
        'Injector is already disposed. Please don\'t use it anymore. Tried to inject "baz".'
      );
    });

    it('should be able to decorate an existing token', () => {
      class Foo {
        public static inject = tokens('answer');
        constructor(innerFoo: { answer: number }) {
          this.answer = innerFoo.answer + 1;
        }
        public answer: number;
      }

      const answerProvider = rootInjector
        .provideValue('answer', { answer: 40 })
        .provideClass('answer2', Foo);

      expect(answerProvider.resolve('answer2').answer).eq(41);
    });
  });

  describe(rootInjector.dispose.name, () => {
    it('should dispose all disposable singleton dependencies', async () => {
      // Arrange
      class Foo {
        public dispose2 = sinon.stub();
        public dispose = sinon.stub();
      }
      function barFactory(): Disposable & { dispose3(): void } {
        return { dispose: sinon.stub(), dispose3: sinon.stub() };
      }
      class Baz {
        constructor(
          public readonly bar: Disposable & { dispose3(): void },
          public readonly foo: Foo
        ) {}
        public static inject = tokens('bar', 'foo');
      }
      const bazInjector = rootInjector
        .provideClass('foo', Foo)
        .provideFactory('bar', barFactory);
      const baz = bazInjector.injectClass(Baz);

      // Act
      await bazInjector.dispose();

      // Assert
      expect(baz.bar.dispose).called;
      expect(baz.foo.dispose).called;
      expect(baz.foo.dispose2).not.called;
      expect(baz.bar.dispose3).not.called;
    });

    it('should also dispose transient dependencies', async () => {
      class Foo {
        public dispose = sinon.stub();
      }
      function barFactory(): Disposable {
        return { dispose: sinon.stub() };
      }
      class Baz {
        constructor(
          public readonly bar: Disposable,
          public readonly foo: Foo
        ) {}
        public static inject = tokens('bar', 'foo');
      }
      const bazInjector = rootInjector
        .provideClass('foo', Foo, Scope.Transient)
        .provideFactory('bar', barFactory, Scope.Transient);
      const baz = bazInjector.injectClass(Baz);

      // Act
      await bazInjector.dispose();

      // Assert
      expect(baz.bar.dispose).called;
      expect(baz.foo.dispose).called;
    });

    it('should dispose dependencies in correct order (child first)', async () => {
      class Grandparent {
        public dispose = sinon.stub();
      }
      class Parent {
        public dispose = sinon.stub();
      }
      class Child {
        constructor(
          public readonly parent: Parent,
          public readonly grandparent: Grandparent
        ) {}
        public static inject = tokens('parent', 'grandparent');
        public dispose = sinon.stub();
      }
      const bazProvider = rootInjector
        .provideClass('grandparent', Grandparent, Scope.Transient)
        .provideClass('parent', Parent)
        .provideClass('child', Child);
      const child = bazProvider.resolve('child');
      const newGrandparent = bazProvider.resolve('grandparent');

      // Act
      await bazProvider.dispose();

      // Assert
      expect(child.parent.dispose).calledBefore(child.grandparent.dispose);
      expect(child.parent.dispose).calledBefore(newGrandparent.dispose);
      expect(child.dispose).calledBefore(child.parent.dispose);
    });

    it('should not dispose injected classes or functions', async () => {
      class Foo {
        public dispose = sinon.stub();
      }
      function barFactory(): Disposable {
        return { dispose: sinon.stub() };
      }
      const foo = rootInjector.injectClass(Foo);
      const bar = rootInjector.injectFunction(barFactory);
      await rootInjector.dispose();
      expect(foo.dispose).not.called;
      expect(bar.dispose).not.called;
    });

    it('should not dispose providedValues', async () => {
      const disposable: Disposable = { dispose: sinon.stub() };
      const disposableProvider = rootInjector.provideValue(
        'disposable',
        disposable
      );
      disposableProvider.resolve('disposable');
      await disposableProvider.dispose();
      expect(disposable.dispose).not.called;
    });

    it('should not break on non-disposable dependencies', async () => {
      class Foo {
        public dispose = true;
      }
      function barFactory(): { dispose: string } {
        return { dispose: 'no-fn' };
      }
      class Baz {
        constructor(
          public readonly bar: { dispose: string },
          public readonly foo: Foo
        ) {}
        public static inject = tokens('bar', 'foo');
      }
      const bazInjector = rootInjector
        .provideClass('foo', Foo)
        .provideFactory('bar', barFactory);
      const baz = bazInjector.injectClass(Baz);

      // Act
      await bazInjector.dispose();

      // Assert
      expect(baz.bar.dispose).eq('no-fn');
      expect(baz.foo.dispose).eq(true);
    });

    it('should not dispose dependencies twice', async () => {
      const fooProvider = rootInjector.provideClass(
        'foo',
        class Foo implements Disposable {
          public dispose = sinon.stub();
        }
      );
      const foo = fooProvider.resolve('foo');
      await fooProvider.dispose();
      await fooProvider.dispose();
      expect(foo.dispose).calledOnce;
    });

    it('should await dispose()', async () => {
      // Arrange
      const fooStub = sinon.stub();
      class Foo {
        public task = new Task();
        public dispose() {
          fooStub();
          return this.task.promise;
        }
      }
      const fooProvider = rootInjector.provideClass('foo', Foo);
      const foo = fooProvider.resolve('foo');
      let resolved = false;

      // Act
      const promise = fooProvider.dispose().then(() => {
        resolved = true;
      });
      await tick(); // make sure it has a chance to fail.

      // Assert
      expect(fooStub).called;
      expect(resolved).false;
      foo.task.resolve();
      await promise;
      expect(resolved).true;
    });
  });

  describe('dependency tree', () => {
    it('should be able to inject a dependency tree', () => {
      // Arrange
      class Logger {
        public info(_msg: string) {}
      }
      class GrandChild {
        public baz = 'qux';
        constructor(public log: Logger) {}
        public static inject = tokens('logger');
      }
      class Child1 {
        public bar = 'foo';
        constructor(public log: Logger, public grandchild: GrandChild) {}
        public static inject = tokens('logger', 'grandChild');
      }
      class Child2 {
        public foo = 'bar';
        constructor(public log: Logger) {}
        public static inject = tokens('logger');
      }
      class Parent {
        constructor(
          public readonly child: Child1,
          public readonly child2: Child2,
          public readonly log: Logger
        ) {}
        public static inject = tokens('child1', 'child2', 'logger');
      }
      const expectedLogger = new Logger();

      // Act
      const actual = rootInjector
        .provideValue('logger', expectedLogger)
        .provideClass('grandChild', GrandChild)
        .provideClass('child1', Child1)
        .provideClass('child2', Child2)
        .injectClass(Parent);

      // Assert
      expect(actual.child.bar).eq('foo');
      expect(actual.child2.foo).eq('bar');
      expect(actual.child.log).eq(expectedLogger);
      expect(actual.child2.log).eq(expectedLogger);
      expect(actual.child.grandchild.log).eq(expectedLogger);
      expect(actual.child.grandchild.baz).eq('qux');
      expect(actual.log).eq(expectedLogger);
    });
  });

  describe('>50 provisions', () => {
    function getBigContainer() {
      return rootInjector
        .provideValue('1', '1')
        .provideValue('2', '2')
        .provideValue('3', '3')
        .provideValue('4', '4')
        .provideValue('5', '5')
        .provideValue('6', '6')
        .provideValue('7', '7')
        .provideValue('8', '8')
        .provideValue('9', '9')
        .provideValue('10', '10')
        .provideValue('11', '11')
        .provideValue('12', '12')
        .provideValue('13', '13')
        .provideValue('14', '14')
        .provideValue('15', '15')
        .provideValue('16', '16')
        .provideValue('17', '17')
        .provideValue('18', '18')
        .provideValue('19', '19')
        .provideValue('20', '20')
        .provideValue('21', '21')
        .provideValue('22', '22')
        .provideValue('23', '23')
        .provideValue('24', '24')
        .provideValue('25', '25')
        .provideValue('26', '26')
        .provideValue('27', '27')
        .provideValue('28', '28')
        .provideValue('29', '29')
        .provideValue('30', '30')
        .provideValue('31', '31')
        .provideValue('32', '32')
        .provideValue('33', '33')
        .provideValue('34', '34')
        .provideValue('35', '35')
        .provideValue('36', '36')
        .provideValue('37', '37')
        .provideValue('38', '38')
        .provideValue('39', '39')
        .provideValue('40', '40')
        .provideValue('41', '41')
        .provideValue('42', '42')
        .provideValue('43', '43')
        .provideValue('44', '44')
        .provideValue('45', '45')
        .provideValue('46', '46')
        .provideValue('47', '47')
        .provideValue('48', '48')
        .provideValue('49', '49')
        .provideValue('50', '50')
        .provideValue('51', '51')
        .provideValue('52', '52')
        .provideValue('53', '53')
        .provideValue('54', '54')
        .provideValue('55', '55')
        .provideValue('56', '55')
        .provideValue('57', '55')
        .provideValue('58', '55')
        .provideValue('59', '55')
        .provideValue('60', '50')
        .provideValue('61', '51')
        .provideValue('62', '52')
        .provideValue('63', '53')
        .provideValue('64', '54')
        .provideValue('65', '55')
        .provideValue('66', '55')
        .provideValue('67', '55')
        .provideValue('68', '55')
        .provideValue('69', '55')
        .provideValue('70', '50')
        .provideValue('71', '51')
        .provideValue('72', '52')
        .provideValue('73', '53')
        .provideValue('74', '54')
        .provideValue('75', '55')
        .provideValue('76', '55')
        .provideValue('77', '55')
        .provideValue('78', '55')
        .provideValue('79', '55');
    }
    it('should handle more than 50 injections without typescript errors', () => {
      const bigContainer = getBigContainer();
      const one = bigContainer.resolve('1');
      expect(one).to.be.eq('1');
      const fiftyfive = bigContainer.resolve('55');
      expect(fiftyfive).to.be.eq('55');
    });
  });
});
