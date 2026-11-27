export const projectRoot: string;
export const resourcesRoot: string;
export const userDataRoot: string;
export const projectPython: string;
export function pythonExecutable(): string;
export function checkPython(command?: string, modules?: boolean): void;
