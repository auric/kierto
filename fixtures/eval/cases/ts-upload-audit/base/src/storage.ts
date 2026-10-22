export interface BlobStore {
  // Copies the file at path to key and replaces an older blob. The caller still owns the file.
  putFile(key: string, path: string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  url(key: string): string;
}
