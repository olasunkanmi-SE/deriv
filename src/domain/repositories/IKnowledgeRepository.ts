export interface KnowledgeFile {
  fileName: string;
  content: string;
}

export interface IKnowledgeRepository {
  loadFiles(): Promise<KnowledgeFile[]>;
}
