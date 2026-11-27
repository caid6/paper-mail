export type StorageOperation = {canceled:boolean;restarting?:boolean};

declare global {
  interface Window {
    paperMailDesktop?: {
      openPdfFolder(paperId?:string):Promise<void>;
      changeStorageLocation():Promise<StorageOperation>;
    };
  }
}

export {};
