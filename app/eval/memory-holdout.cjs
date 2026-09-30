// Fresh questions and answer rubrics, fixed before any AI-generated digest or answer.
// Keys refer only to the synthetic notes in memory-fixture.cjs.
module.exports=[
  {id:'h01',type:'specific',question:'仕事をするとき、歌のない音を選ぶ場面はある？',required:['m_work'],must:['作業中','歌詞のないピアノ'],forbid:['いつも歌詞を避ける']},
  {id:'h02',type:'specific',question:'来月の演奏会について、どこまで準備した？',required:['m_live_wish'],must:['ピアノライブ','チケット未購入'],forbid:['予約済み','参加した']},
  {id:'h03',type:'specific',question:'ジャズを退屈と感じているのは本人？',required:['m_jazz_article','m_jazz_new'],must:['記事の筆者','本人は最近好きになりつつある'],forbid:['本人が退屈と断言']},
  {id:'h04',type:'specific',question:'「月の庭」の感想はもう書いている？',required:['f_wish'],must:['予告編のみ','本編未鑑賞'],forbid:['映画を観た感想']},
  {id:'h05',type:'specific',question:'映画「青い港」への本人と批評家の評価を教えて',required:['f_seen','f_article'],must:['本人は静かな結末が好き','記事の筆者は退屈と評した'],forbid:['本人が退屈と評した']},
  {id:'h06',type:'specific',question:'京都旅行は今年も済ませた？',required:['l_kyoto_seen','l_kyoto_wish'],must:['昨年訪問','今年は未定'],forbid:['今年も訪問済み']},
  {id:'h07',type:'specific',question:'辛いスープを料理した記録はある？',required:['c_article'],must:['記事で見たレシピ','未調理'],forbid:['辛いスープを作った']},
  {id:'h08',type:'specific',question:'退職の話は自分の悩みとして書いた？',required:['w_quote'],must:['記事の筆者の意見','本人は辞めたいと思っていない'],forbid:['本人の退職希望']},
  {id:'h09',type:'global',question:'音楽の好みは一貫して同じジャンル？',required:['m_work','m_run','m_lyrics'],must:['場面によって違う','ピアノ','電子音楽'],forbid:['歌詞のある曲は嫌い']},
  {id:'h10',type:'global',question:'ジャズとホラーへの印象は前と今でどう変わった？',required:['m_jazz_old','m_jazz_new','f_horror_old','f_horror_new'],must:['ジャズは苦手から好意へ','ホラーは回避から楽しめるへ'],forbid:['今も両方苦手']},
  {id:'h11',type:'global',question:'読んだ本だけを挙げ、未読は分けて',required:['b_read','b_dislike','b_wish'],must:['星の橋は読了','砂の手紙は読んだ','冬の地図は未読'],forbid:['冬の地図を読了']},
  {id:'h12',type:'global',question:'pureでまず検証したいことと画面の考えは？',required:['p_graph','p_block','p_step'],must:['根拠あるGraph','古い要約の問題','Ask検索の評価'],forbid:['Graphは飾りだけでよい']},
  {id:'h13',type:'cross',question:'実際に行った場所と、まだ行っていない場所を整理して',required:['l_kyoto_seen','l_tokyo','l_sea'],must:['京都と東京は訪問','海辺の町は未訪問'],forbid:['海辺の町を訪問済み']},
  {id:'h14',type:'cross',question:'まだ手配していない趣味や外出の予定は？',required:['m_live_wish','h_pottery_wish','l_kyoto_wish'],must:['ライブのチケット未購入','陶芸教室は未予約','京都は予定未定'],forbid:['すべて予約済み']},
  {id:'h15',type:'cross',question:'古い街並みに関心が見えるメモを挙げて',required:['f_doc','h_photo','l_kyoto_seen'],must:['街の記録の映画','古い看板の写真','京都の路地'],forbid:['古い街に無関心']},
  {id:'h16',type:'cross',question:'集中しやすい環境と回復に役立ったことは？',required:['m_work','w_remote','w_break'],must:['歌詞のないピアノ','静かな作業は在宅','午後の短い休憩'],forbid:['オフィスなら常に集中できる']},
  {id:'h17',type:'unanswerable',question:'「月の庭」の上映時間は何分？',required:[],must:['メモからは分からない'],forbid:['分です']},
  {id:'h18',type:'unanswerable',question:'ピアノライブのチケットはいくら？',required:[],must:['メモからは分からない'],forbid:['円です']},
  {id:'h19',type:'unanswerable',question:'飼っている猫の名前は？',required:[],must:['メモからは分からない'],forbid:['猫の名前は']}
];
