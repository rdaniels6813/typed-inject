export type TChildContext<TProvided, CurrentToken extends string> = {
  [K in keyof ({ [K in CurrentToken]: TProvided })]: K extends CurrentToken ? TProvided : never;
};
