export interface IArtifactRepository {
  write<T>(fileName: string, data: T): Promise<void>;
  read<T>(fileName: string): Promise<T>;
  exists(fileName: string): Promise<boolean>;
  appendLine(fileName: string, line: string): Promise<void>;
}
