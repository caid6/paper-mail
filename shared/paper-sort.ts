export const paperSortFields = ['indexed_at', 'received_at', 'publication_date'] as const;
export type PaperSort = typeof paperSortFields[number];

export const paperDateLabels: Record<PaperSort, {option:string; label:string}> = {
  indexed_at: {option:'PubMed 收录日期', label:'PubMed 收录'},
  received_at: {option:'研邮收信时间', label:'研邮收信'},
  publication_date: {option:'论文发表日期', label:'发表'},
};
