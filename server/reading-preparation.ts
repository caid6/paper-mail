import {aiConfigured} from './ai.ts';
import type {DB} from './core.ts';
import {downloadedPath,pumpDownloads} from './downloads.ts';
import {markMissingDownload,pumpDocumentIndexes} from './documents.ts';
import {pumpFigures,pumpFulltexts} from './figures.ts';
import {readingScope} from './reading-scope.ts';

export function queueReadingPreparation(db:DB){
 const scope=readingScope(db);
 db.prepare(`INSERT OR IGNORE INTO downloads(paper_id,status,created_at,automatic)
   SELECT p.id,'pending',?,1 FROM papers p WHERE ${scope}`).run(new Date().toISOString());
 db.exec(`INSERT INTO fulltexts(paper_id,status,automatic)
   SELECT p.id,'pending',1 FROM papers p WHERE (${scope}) AND p.pmcid<>''
   ON CONFLICT(paper_id) DO UPDATE SET status='pending',automatic=1,error=NULL
   WHERE fulltexts.status='idle' OR (fulltexts.status='unavailable' AND fulltexts.fetched_at IS NULL AND fulltexts.source_url IS NULL AND fulltexts.error='没有可访问的 PMC 全文')`);
}

export function prepareReading(db:DB,root:string){
 queueReadingPreparation(db);
 for(const row of db.prepare(`SELECT d.paper_id FROM downloads d JOIN papers p ON p.id=d.paper_id
   WHERE d.status='ready' AND (${readingScope(db)})`).iterate()){
  const id=String(row.paper_id);
  if(!downloadedPath(db,root,id))markMissingDownload(db,id);
 }
 const index=()=>void pumpDocumentIndexes(db,root).catch(error=>console.error('PDF 文本解析队列失败',error.message));
 index();
 const download=()=>void pumpDownloads(db,root,index).catch(error=>console.error('PDF 下载队列失败',error.message));
 download();
 void pumpFulltexts(db,root,download).catch(error=>console.error('PMC 全文队列失败',error.message));
 void pumpFigures(db,root).catch(error=>console.error('主图队列失败',error.message));
}

export function readingPreparationStats(db:DB){
 const scope=readingScope(db);
 return db.prepare(`SELECT COUNT(*) AS pending FROM papers p
   LEFT JOIN downloads d ON d.paper_id=p.id LEFT JOIN pdf_documents pdf ON pdf.paper_id=p.id
   LEFT JOIN fulltexts t ON t.paper_id=p.id
   WHERE (${scope}) AND (d.status IN ('pending','running')
     OR (d.status='ready' AND d.index_error IS NULL AND (pdf.file_name IS NULL OR pdf.file_name<>d.file_name))
     OR t.status IN ('pending','loading')
     OR EXISTS(SELECT 1 FROM figures f WHERE f.paper_id=p.id AND
       (f.status='generating' OR (f.status='pending' AND (? OR f.image_path='')))))`).get(Number(aiConfigured()));
}
