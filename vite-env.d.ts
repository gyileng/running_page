/// <reference types="vite/client" />

declare module '@config' {
  const config: Record<string, unknown>;
  export default config;
}

declare module '@shoes' {
  const shoes: Record<string, unknown>;
  export default shoes;
}

declare module '*.yml' {
  const content: Record<string, unknown>;
  export default content;
}
