import {aiConfigured} from './ai.ts';
import type {DB} from './core.ts';
import {downloadedPath,downloadInfo,pumpDownloads} from './downloads.ts';
import {markMissingDownload,pumpDocumentIndexes} from './documents.ts';
import {pumpPublisherFigures,pumpPDFFigureIndexes,pumpFigures,pumpFulltexts,needsPDFFigureIndex} from './figures.ts';
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
 const index=()=>void pumpDocumentIndexes(db,root).then(()=>Promise.all([
  pumpPublisherFigures(db,root).then(()=>pumpPDFFigureIndexes(db,root)).then(()=>pumpFigures(db,root)),
  pumpPDFFigureIndexes(db,root).then(()=>pumpFigures(db,root)),
 ])).catch(error=>console.error('全文图文准备失败',error.message));
 index();
 const download=()=>void pumpDownloads(db,root,index).catch(error=>console.error('PDF 下载队列失败',error.message));
 download();
 void pumpFulltexts(db,root,()=>{download();index();}).catch(error=>console.error('PMC 全文队列失败',error.message));
 void pumpFigures(db,root).catch(error=>console.error('主图队列失败',error.message));
}

export function readingPreparationStats(db:DB){
 const scope=readingScope(db);
 return db.prepare(`WITH stages AS (
   SELECT
     (d.status='running' OR (:pdfReady AND d.status='pending') OR t.status IN ('pending','loading')
       OR EXISTS(SELECT 1 FROM figures f WHERE f.paper_id=p.id AND f.image_path='' AND f.status IN ('pending','fetching'))) AS downloading,
     (:pdfReady AND d.status='ready' AND (
       (d.index_error IS NULL AND (pd.file_name IS NULL OR pd.file_name<>d.file_name))
       OR (pd.file_name=d.file_name AND (pf.status='processing' OR (${needsPDFFigureIndex})))))
       OR pi.status='processing'
       OR (p.doi LIKE '10.1038/%' AND (pi.status='pending' OR pi.paper_id IS NULL OR pi.fingerprint<>lower(p.doi))
         AND (t.status IS NULL OR t.status NOT IN ('pending','loading'))
         AND NOT EXISTS(SELECT 1 FROM figures f WHERE f.paper_id=p.id AND f.origin='pmc')) AS parsing,
     EXISTS(SELECT 1 FROM figures f WHERE f.paper_id=p.id AND f.image_path<>'' AND f.status IN ('pending','generating')) AS figure_analysis
   FROM papers p LEFT JOIN downloads d ON d.paper_id=p.id LEFT JOIN pdf_documents pd ON pd.paper_id=p.id
   LEFT JOIN fulltexts t ON t.paper_id=p.id LEFT JOIN pdf_figure_indexes pf ON pf.paper_id=p.id
   LEFT JOIN publisher_figure_indexes pi ON pi.paper_id=p.id WHERE ${scope}
 ) SELECT COUNT(*) FILTER (WHERE downloading OR parsing OR (:modelReady AND figure_analysis)) AS pending,
   COUNT(*) FILTER (WHERE downloading) AS downloading, COUNT(*) FILTER (WHERE parsing) AS parsing,
   COUNT(*) FILTER (WHERE :modelReady AND figure_analysis) AS analyzing,
   COUNT(*) FILTER (WHERE NOT :modelReady AND figure_analysis) AS waiting_for_model FROM stages`)
  .get({pdfReady:Number(downloadInfo().available),modelReady:Number(aiConfigured())}) as {
    pending:number;downloading:number;parsing:number;analyzing:number;waiting_for_model:number;
  };
}
