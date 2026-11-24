export function JournalBadge({paper,detail=false}:{paper:{
 impact_factor:number|null;jif_label?:string;jif_status?:string;cas_zone?:number|null;metric_year:number|null;
 metric_edition:number|null;metric_match?:string;metric_source?:string;
};detail?:boolean}){
 const value=paper.impact_factor?.toFixed(1)||paper.jif_label;
 const unknown=paper.jif_status==='suppressed'?'Clarivate 暂停公布此期刊的 2025 JIF':
  paper.jif_status==='no_catalog_jif'?'期刊 ISSN 已核实，当前 JCR 目录暂无 2025 JIF':
  paper.metric_year===null?'期刊目录中没有唯一匹配的记录':'此期刊未公布 2025 JIF';
 const provenance=`${paper.metric_year} JIF · ${paper.metric_edition} 年公布 · ${paper.metric_match==='issn'?'ISSN 精确匹配':'期刊名匹配'}${paper.metric_source?' · '+paper.metric_source:''}`;
 return <span className={'journal-metrics '+(value?'':'unknown')} title={value?provenance:unknown}>
  <strong>{value?`IF ${value}`:'IF 无数据'}</strong>
  {detail&&value&&<span>{paper.metric_year} JIF · {paper.metric_edition} 年公布</span>}
  {detail&&paper.cas_zone&&<span>中科院 {paper.cas_zone} 区（仅供参考）</span>}
 </span>;
}
