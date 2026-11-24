import {localClock} from './core.ts';
import {pubmedDateClause} from './pubmed.ts';

// A topic edit uses the same initialized window plus daily additions since initialization.
export function subscriptionDateClause(settings:Record<string,string>,now=new Date()){
 if(!settings.library_initialized_on||!settings.initialize_start||!settings.initialize_end)return '';
 const field=settings.initialize_date_field==='pdat'?'pdat':'crdt';
 const initial=pubmedDateClause(settings.initialize_start,settings.initialize_end,field);
 const today=localClock(now,settings.timezone).date;
 if(settings.library_initialized_on>today)return initial;
 return '('+initial+') OR ('+pubmedDateClause(settings.library_initialized_on,today,'crdt')+')';
}
