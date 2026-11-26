import {aiConfigured} from './ai.ts';
import type {DB} from './core.ts';
import {mailboxJournalWhere} from './journals.ts';

export function readingScope(db:DB){
  const waitingForQuality=aiConfigured()? `AND (p.manual_added=1 OR NOT EXISTS (
    SELECT 1 FROM relevance_reviews r JOIN paper_subscriptions ps
      ON ps.paper_id=r.paper_id AND ps.subscription_id=r.subscription_id
    WHERE r.paper_id=p.id AND r.status IN ('pending','running')
      AND (SELECT value FROM settings WHERE key='quality_enabled')='true'
  ))` : '';
  return `(p.source='pubmed' OR p.manual_added=1) AND p.archived=0 AND p.in_library=1 AND ${mailboxJournalWhere(db)} ${waitingForQuality}`;
}
