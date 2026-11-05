// 本機沒有 @types/react 時用來做基本型別檢查。正式開發請安裝 package.json 的 @types/react。
declare module 'react' {
  export type ReactNode = any;
  export type FormEvent = { preventDefault(): void };
  export function useState<S>(init: S | (() => S)): [S, (v: S | ((p: S) => S)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: unknown[]): T;
  export function useCallback<T>(fn: T, deps: unknown[]): T;
  export function useRef<T>(v: T): { current: T };
  export function useRef<T>(v: T | null): { current: T | null };
  export function useContext<T>(c: Context<T>): T;
  export function createContext<T>(v: T): Context<T>;
  export interface Context<T> { Provider: (p: { value: T; children?: any }) => any }
}
declare module 'react/jsx-runtime' {
  export const jsx: any; export const jsxs: any; export const Fragment: any;
  export namespace JSX {
    interface IntrinsicAttributes { key?: any }
    interface IntrinsicElements { [name: string]: any }
    type Element = any;
  }
}
declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: any): void };
}
declare module '*.css';
