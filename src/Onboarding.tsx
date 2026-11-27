import {BookOpen, CheckCircle2, ChevronRight, Clock, Filter, PlugZap, Tags} from 'lucide-react';
import type {State} from './types';

export type SetupDestination = 'api' | 'topics' | 'library' | 'delivery';

const steps = [
  {id: 'api', title: '连接 AI 模型', detail: '填写 OpenAI 兼容服务地址、密钥和模型，验证后保存。', icon: PlugZap},
  {id: 'topics', title: '添加研究方向', detail: '生成或填写 PubMed 检索式，验证并保存至少一个方向。', icon: Tags},
  {id: 'library', title: '筛选与初始化', detail: '设置文献筛选条件和日期范围，完成文献库初始化。', icon: Filter},
  {id: 'delivery', title: '安排每日收信', detail: '设定收取时间、时区和每次检查篇数，然后保存。', icon: Clock},
] as const;

export function Onboarding({setup, onOpen, onDone, saving}: {
  setup: State['setup'];
  onOpen: (destination: SetupDestination) => void;
  onDone: () => void;
  saving: boolean;
}) {
  return <>
    <div className="onboarding-content">
      <ul className="onboarding-steps">
        {steps.map(({id, title, detail, icon: Icon}) => <li key={id}>
          <button type="button" onClick={() => onOpen(id)} disabled={saving} aria-label={title}>
            <Icon size={18} aria-hidden="true"/>
            <span><strong>{title}</strong><span>{detail}</span></span>
            {setup[id]?<CheckCircle2 className="onboarding-step-done" size={17} aria-label="已完成"/>:<ChevronRight size={16} aria-hidden="true"/>}
          </button>
        </li>)}
      </ul>
      <div className="onboarding-reading">
        <BookOpen size={18} aria-hidden="true"/>
        <p>收取后，点开论文可看摘要、导读和全文入口。想留待重读就加星标，读完可以归档。</p>
      </div>
    </div>
    <footer className="onboarding-footer">
      {setup.complete?<button type="button" className="button primary" onClick={onDone} disabled={saving}>进入收件箱</button>:<span role="status">还需完成：{steps.filter(step=>!setup[step.id]).map(step=>step.title).join('、')}</span>}
    </footer>
  </>;
}
