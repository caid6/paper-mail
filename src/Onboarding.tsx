import {BookOpen, ChevronRight, Clock, Filter, PlugZap, Tags} from 'lucide-react';

export type SetupDestination = 'api' | 'topics' | 'library' | 'delivery';

const steps = [
  {id: 'api', title: '连接 AI 模型', detail: '填入自己的 API 地址和密钥，选择模型后验证并保存。只用 PubMed 检索和原文摘要时可以跳过。', icon: PlugZap},
  {id: 'topics', title: '添加研究方向', detail: '描述你想追踪的课题，让模型生成检索式。也可以粘贴自己的 PubMed 检索式，验证后保存。', icon: Tags},
  {id: 'library', title: '筛选与初始化', detail: '按需设定期刊和影响因子。想回看过去的论文，可选日期范围建立第一批收件箱。', icon: Filter},
  {id: 'delivery', title: '安排每日收信', detail: '设定自动收取的时间和时区。也可从收件箱手动收取最新论文。', icon: Clock},
] as const;

export function Onboarding({onOpen, onDone, saving}: {
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
            <ChevronRight size={16} aria-hidden="true"/>
          </button>
        </li>)}
      </ul>
      <div className="onboarding-reading">
        <BookOpen size={18} aria-hidden="true"/>
        <p>收取后，点开论文可看摘要、导读和全文入口。想留待重读就加星标，读完可以归档。</p>
      </div>
    </div>
    <footer className="onboarding-footer">
      <button type="button" className="button primary" onClick={onDone} disabled={saving}>进入收件箱</button>
    </footer>
  </>;
}
