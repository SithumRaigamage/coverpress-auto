// The one Node API the test suite needs (reading a stylesheet as text).
// Declared here rather than pulling in all of @types/node.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
