export type ImpactOperator = 'gt' | 'gte';
export type ImpactThreshold = {value:number; operator:ImpactOperator};

export function impactComparator(operator:ImpactOperator) {
  return operator === 'gt' ? '>' : '>=';
}

export function passesImpact(
  journal:{impact_factor:number|null; jif_label:string},
  threshold:ImpactThreshold|null,
) {
  if (threshold === null) return true;
  if (journal.impact_factor === null) {
    return journal.jif_label === '<0.1' && threshold.operator === 'gte' && threshold.value === 0;
  }
  return threshold.operator === 'gt'
    ? journal.impact_factor > threshold.value
    : journal.impact_factor >= threshold.value;
}

export function impactLabel(threshold:ImpactThreshold) {
  const symbol = threshold.operator === 'gt' ? '>' : '≥';
  return `IF ${symbol} ${threshold.value}`;
}
