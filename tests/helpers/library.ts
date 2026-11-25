import {connect} from '../../server/core.ts';

const topics = [
  {id:'topic-a',name:'测试方向 A',color:'#547b94',query:'test[Title/Abstract]'},
  {id:'topic-b',name:'测试方向 B',color:'#9b80ad',query:'test[Title/Abstract]'},
  {id:'topic-c',name:'测试方向 C',color:'#c49052',query:'test[Title/Abstract]'},
];

export function connectTestLibrary(path=':memory:'){
  const db=connect(path);
  const insert=db.prepare('INSERT OR IGNORE INTO subscriptions(id,name,color,query) VALUES(?,?,?,?)');
  for(const topic of topics)insert.run(topic.id,topic.name,topic.color,topic.query);
  return db;
}
