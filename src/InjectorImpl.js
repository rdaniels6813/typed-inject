"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Scope_1 = require("./api/Scope");
const InjectionToken_1 = require("./api/InjectionToken");
const Exception_1 = require("./Exception");
const utils_1 = require("./utils");
const DEFAULT_SCOPE = Scope_1.Scope.Singleton;
/*

# Composite design pattern:

         ┏━━━━━━━━━━━━━━━━━━┓
         ┃ AbstractInjector ┃
         ┗━━━━━━━━━━━━━━━━━━┛
                   ▲
                   ┃
          ┏━━━━━━━━┻━━━━━━━━┓
          ┃                 ┃
 ┏━━━━━━━━┻━━━━━┓   ┏━━━━━━━┻━━━━━━━┓
 ┃ RootInjector ┃   ┃ ChildInjector ┃
 ┗━━━━━━━━━━━━━━┛   ┗━━━━━━━━━━━━━━━┛
                            ▲
                            ┃
          ┏━━━━━━━━━━━━━━━━━┻━┳━━━━━━━━━━━━━━━━┓
 ┏━━━━━━━━┻━━━━━━━━┓ ┏━━━━━━━━┻━━━━━━┓ ┏━━━━━━━┻━━━━━━━┓
 ┃ FactoryInjector ┃ ┃ ClassInjector ┃ ┃ ValueInjector ┃
 ┗━━━━━━━━━━━━━━━━━┛ ┗━━━━━━━━━━━━━━━┛ ┗━━━━━━━━━━━━━━━┛
*/
class AbstractInjector {
    injectClass(Class, providedIn) {
        try {
            const args = this.resolveParametersToInject(Class, providedIn);
            return new Class(...args);
        }
        catch (error) {
            throw new Exception_1.Exception(`Could not inject "${Class.name}"`, error);
        }
    }
    injectFunction(fn, providedIn) {
        try {
            const args = this.resolveParametersToInject(fn, providedIn);
            return fn(...args);
        }
        catch (error) {
            throw new Exception_1.Exception(`Could not inject "${fn.name}"`, error);
        }
    }
    resolveParametersToInject(injectable, target) {
        const tokens = injectable.inject || [];
        return tokens.map(key => {
            switch (key) {
                case InjectionToken_1.TARGET_TOKEN:
                    return target;
                case InjectionToken_1.INJECTOR_TOKEN:
                    return this;
                default:
                    return this.resolveInternal(key, injectable);
            }
        });
    }
    provideValue(token, value) {
        return new ValueProvider(this, token, value);
    }
    provideClass(token, Class, scope = DEFAULT_SCOPE) {
        return new ClassProvider(this, token, scope, Class);
    }
    provideFactory(token, factory, scope = DEFAULT_SCOPE) {
        return new FactoryProvider(this, token, scope, factory);
    }
    resolve(token, target) {
        return this.resolveInternal(token, target);
    }
}
class RootInjector extends AbstractInjector {
    resolveInternal(token) {
        throw new Error(`No provider found for "${token}"!.`);
    }
    dispose() {
        return Promise.resolve();
    }
}
class ChildInjector extends AbstractInjector {
    constructor(parent, token, scope) {
        super();
        this.parent = parent;
        this.token = token;
        this.scope = scope;
        this.disposables = new Set();
        this.isDisposed = false;
        let currentParent = this.parent;
        while (currentParent) {
            if (currentParent.token && this.token === currentParent.token) {
                throw new Exception_1.Exception(`Token: ${this.token} is already used on this injector.`);
            }
            currentParent = currentParent.parent;
        }
    }
    injectClass(Class, providedIn) {
        this.throwIfDisposed(Class);
        return super.injectClass(Class, providedIn);
    }
    injectFunction(fn, providedIn) {
        this.throwIfDisposed(fn);
        return super.injectFunction(fn, providedIn);
    }
    resolve(token, target) {
        this.throwIfDisposed(token);
        return super.resolve(token, target);
    }
    throwIfDisposed(injectableOrToken) {
        if (this.isDisposed) {
            throw new Exception_1.Exception(`Injector is already disposed. Please don't use it anymore.${additionalErrorMessage()}`);
        }
        function additionalErrorMessage() {
            if (typeof injectableOrToken === 'function') {
                return ` Tried to inject "${injectableOrToken.name}".`;
            }
            else {
                return ` Tried to resolve "${injectableOrToken}".`;
            }
        }
    }
    async dispose() {
        if (!this.isDisposed) {
            this.isDisposed = true; // be sure new disposables aren't added while we're disposing
            await this.disposeInjectedValues();
            this.parent.dispose();
        }
    }
    async disposeInjectedValues() {
        const promisesToAwait = [...this.disposables.values()]
            .map(disposable => disposable.dispose());
        await Promise.all(promisesToAwait);
    }
    resolveInternal(token, target) {
        if (token === this.token) {
            if (this.cached) {
                return this.cached.value;
            }
            else {
                const value = this.result(target);
                this.addToDisposablesIfNeeded(value);
                this.addToCacheIfNeeded(value);
                return value;
            }
        }
        else {
            return this.parent.resolve(token, target);
        }
    }
    addToCacheIfNeeded(value) {
        if (this.scope === Scope_1.Scope.Singleton) {
            this.cached = { value };
        }
    }
    addToDisposablesIfNeeded(value) {
        if (this.responsibleForDisposing && utils_1.isDisposable(value)) {
            this.disposables.add(value);
        }
    }
}
class ValueProvider extends ChildInjector {
    constructor(parent, token, value) {
        super(parent, token, Scope_1.Scope.Transient);
        this.value = value;
        this.responsibleForDisposing = false;
    }
    result() {
        return this.value;
    }
}
class FactoryProvider extends ChildInjector {
    constructor(parent, token, scope, injectable) {
        super(parent, token, scope);
        this.injectable = injectable;
        this.responsibleForDisposing = true;
    }
    result(target) {
        return this.parent.injectFunction(this.injectable, target);
    }
}
class ClassProvider extends ChildInjector {
    constructor(parent, token, scope, injectable) {
        super(parent, token, scope);
        this.injectable = injectable;
        this.responsibleForDisposing = true;
    }
    result(target) {
        return this.parent.injectClass(this.injectable, target);
    }
}
exports.rootInjector = new RootInjector();
//# sourceMappingURL=InjectorImpl.js.map