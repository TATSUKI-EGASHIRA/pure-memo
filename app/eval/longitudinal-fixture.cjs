// Synthetic follow-up set. Questions and expected source keys are fixed before ranking changes.
const notes=[
  ['music_ambient_old','Music','2024-03-12','集中したいときは環境音を流すと作業が進む。'],
  ['music_ambient_new','Music','2026-09-02','最近は環境音を流すと音の繰り返しが気になる。静かな部屋で作業する方が集中できる。'],
  ['music_live_old','Music','2025-05-10','大きなライブ会場は疲れるので行きたくない。'],
  ['music_live_new','Music','2026-08-18','友人と行った小さなライブハウスは楽しかった。ただ大きな会場はまだ苦手。'],
  ['film_subtitle_old','Films','2024-11-03','以前は字幕映画を避けていた。文字を追うのが疲れた。'],
  ['film_subtitle_new','Films','2026-07-19','最近は短い字幕映画なら楽しめる。長い作品ではまだ疲れる。'],
  ['book_long_old','Books','2025-02-08','長編小説は読む気が起きない。短い話を選んでいた。'],
  ['book_long_new','Books','2026-09-09','通勤が長くなってから長編小説を少しずつ読むようになった。寝る前は短い話がよい。'],
  ['work_remote_old','Work','2024-06-20','以前の職場では在宅勤務だと集中しづらかった。'],
  ['work_remote_new','Work','2026-09-14','今の仕事では一人の設計作業なら在宅勤務が進む。対面の相談はオフィスがよい。'],
  ['food_spice_old','Food','2025-04-25','昔は辛いカレーをよく食べた。'],
  ['food_spice_new','Food','2026-08-30','最近は辛いカレーを食べると胃が疲れるので、甘口を選ぶ。'],
  ['source_music','Music','2026-09-17','保存した記事では「誰もが毎日ジャズを聴くべき」と主張していた。筆者の意見で、私の習慣ではない。'],
  ['plan_film','Films','2026-09-18','映画「冬の灯」は予告だけ見た。来月公開したら観たい。'],
  ['seen_film','Films','2026-09-19','映画「春の灯」を映画館で観た。静かな場面が好きだった。'],
  ['x_generated',null,'2026-09-20','AI生成の下書き: 私はいつも大きなライブ会場へ行く。','generated'],
  ['x_deleted','Work','2026-09-20','削除したメモ: 在宅勤務は毎日嫌い。','trash']
];
const cases=[
  {id:'l01',type:'change',relevantCategories:['Music','Work'],question:'環境音は集中に役立つ？以前と最近で違う？',required:['music_ambient_old','music_ambient_new']},
  {id:'l02',type:'context',relevantCategories:['Music'],question:'ライブ会場は今も全部苦手？',required:['music_live_old','music_live_new']},
  {id:'l03',type:'change',relevantCategories:['Films'],question:'字幕映画の好みは変わった？',required:['film_subtitle_old','film_subtitle_new']},
  {id:'l04',type:'context',relevantCategories:['Books'],question:'長編小説を読むようになった？寝る前は？',required:['book_long_old','book_long_new']},
  {id:'l05',type:'change',relevantCategories:['Work'],question:'在宅勤務への考えは前の職場と今で違う？',required:['work_remote_old','work_remote_new']},
  {id:'l06',type:'change',relevantCategories:['Food'],question:'辛いカレーは昔と最近で好みが同じ？',required:['food_spice_old','food_spice_new']},
  {id:'l07',type:'attribution',relevantCategories:['Music'],question:'毎日ジャズを聴くべきだと本人が考えている？',required:['source_music']},
  {id:'l08',type:'state',relevantCategories:['Films'],question:'冬の灯と春の灯はどちらを観た？',required:['plan_film','seen_film']},
  {id:'l09',type:'context',relevantCategories:['Music','Work'],question:'今の集中に合う音や場所は？',required:['music_ambient_new','work_remote_new']},
  {id:'l10',type:'context',relevantCategories:['Books','Films'],question:'今も長い作品は苦手？小説と映画で違う？',required:['film_subtitle_new','book_long_new']},
  {id:'l11',type:'unanswerable',relevantCategories:[],question:'飼っている犬の名前は？',required:[]},
  {id:'l12',type:'unanswerable',relevantCategories:['Films'],question:'映画「冬の灯」の上映時間は何分？',required:['plan_film']}
];
module.exports={notes,cases};
