// Minimal types for Node's built-in test runner (the project has no @types/node).
declare module 'node:test' {
    export function test(name: string, fn: () => void | Promise<void>): void;
}
declare module 'node:assert/strict' {
    interface Assert {
        (value: unknown, message?: string): asserts value;
        ok(value: unknown, message?: string): asserts value;
        equal<T>(actual: T, expected: T, message?: string): void;
        deepEqual<T>(actual: T, expected: T, message?: string): void;
        notEqual<T>(actual: T, expected: T, message?: string): void;
    }
    const assert: Assert;
    export default assert;
}
