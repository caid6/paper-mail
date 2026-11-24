import {z} from 'zod';
import {jsonCompletion} from './ai.ts';
import {categoryJournals,journalCategories,journalGroups,journalOptions,resolveJournal} from './journals.ts';

const journalGroupNames = z.enum(['cns','cell_family','nature_family','science_family','medical_four']);
const selectors = {
  groups: z.array(journalGroupNames).max(5),
  categories: z.array(z.object({name:z.enum(journalCategories),quartile:z.enum(['q1','all'])})).max(20),
  names: z.array(z.string().trim().min(1).max(200)).max(100),
};
const planSchema = z.object({
  include:z.object(selectors),
  exclude:z.object(selectors),
  impact:z.object({operator:z.enum(['gt','gte']),value:z.number().min(0).max(1000)}).nullable(),
  unresolved:z.array(z.string().trim().min(1).max(200)).max(30),
  interpretation:z.string().trim().min(1).max(600),
});
type Plan = z.infer<typeof planSchema>;

export function expandJournalPlan(plan: Plan) {
  const unresolved = new Set(plan.unresolved);
  const catalogMissing = new Set<string>();
  function resolve(selection: Plan['include']) {
    const result = new Set<string>();
    for (const group of selection.groups) {
      for (const name of journalGroups[group]) {
        const id = resolveJournal(name);
        if (id) result.add(id);
        else catalogMissing.add(name);
      }
    }
    for (const category of selection.categories) {
      for (const id of categoryJournals(category.name, category.quartile === 'q1')) result.add(id);
    }
    for (const name of selection.names) {
      const id = resolveJournal(name);
      if (id) result.add(id);
      else unresolved.add(name);
    }
    return result;
  }
  const included = resolve(plan.include);
  for (const id of resolve(plan.exclude)) included.delete(id);
  if (included.size > 2500) throw new Error('期刊清单超过 2500 本，请缩小范围');
  return {
    journals:journalOptions([...included]).sort((a,b)=>(b.impact_factor??-1)-(a.impact_factor??-1)||a.name.localeCompare(b.name)),
    impact:plan.impact, unresolved:[...unresolved], catalog_missing_count:catalogMissing.size,
    interpretation:plan.interpretation,
  };
}
export async function generateJournalPlan(description: string) {
  const plan = await jsonCompletion(planSchema, [
    '将用户的期刊筛选意图解析为期刊组、JCR 类别和明确期刊名，各组之间取并集，再减去排除项。',
    'cns 是 Cell、Nature、Science 三个出版集团的期刊组合，cell_family、nature_family、science_family 是各自系列。',
    'medical_four 只包括 NEJM、Lancet、JAMA、BMJ 正刊。只要 CNS 三本正刊时使用 names。',
    '领域顶刊默认采用对应 JCR 学科的 Q1。胃肠或消化使用 GASTROENTEROLOGY & HEPATOLOGY（按 schema 中的实际学科拼写）。',
    '有明确指定刊名或少量代表性期刊时用目录中可能存在的正式英文全名或 ISSN。专科推测需要在 interpretation 说明。',
    '用户明确说严格大于、不含等于或 > 时使用 gt。用户说不要纳入 N 分以下、N 分以上、至少、不低于、大于等于或 ≥ 时使用 gte，N 本身应纳入。中文日常表达 IF 大于 N 如果同时表达了不要纳入 N 以下，按 gte 处理。value 保留原始数值。未指定 IF 条件时填 null。不能用单个下限表示的条件写入 unresolved。',
    '期刊组、分类和具体刊名无法可靠确定时写入 unresolved。无需给出 IF 数字或生成 PubMed 语法。interpretation 用简短中文说明范围。',
    'JSON 示例 {"include":{"groups":["medical_four"],"categories":[],"names":[]},"exclude":{"groups":[],"categories":[],"names":[]},"impact":{"operator":"gt","value":10},"unresolved":[],"interpretation":"四大医学期刊正刊，IF 大于 10"}。',
  ].join('\n'),{description},{compatibleFormat:'json_object'});
  return expandJournalPlan(plan);
}
