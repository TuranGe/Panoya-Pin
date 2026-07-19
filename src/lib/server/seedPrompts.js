// Grup yeterince içerik girmediyse havuzu tamamlamak için kullanılan
// genel-geçer yedek içerikler. Amaç grubun kendi içeriğinin yerini almak değil,
// az kişiyle yapılan ilk denemelerde oyunun oynanabilir kalmasını sağlamak.

export const DEFAULT_KIM_YAPAR_PROMPTS = [
	'Toplantıya en son geç kalan kim olur?',
	"Gece yarısı 3'te \"uyanık mısın\" diye mesaj atma ihtimali en yüksek kim?",
	'Tatile giderken valizini son ana bırakan kim olur?',
	'Grup sohbetinde en çok sesli mesaj atan kim olur?',
	'Bir kaçış odasında lider rolünü kapan kim olur?',
	'Hiç sebep yokken aniden şehir değiştirmeye karar verecek kim olur?',
	'Restoranda herkes adına sipariş vermeye kalkışan kim olur?',
	'En garip saatte spora gitme kararı alan kim olur?',
	'Bir yol gezisinde haritayı kaybettiren kim olur?',
	'Karaokede mikrofonu bırakmayan kim olur?',
	'Grup projesinde son ana her şeyi bırakan kim olur?',
	'Bir kavgada arayı bulmaya çalışan kim olur?',
	'Herkesi bir fikirle ikna edip sonra vazgeçen kim olur?',
	'Telefonunu en sık kaybeden/unutan kim olur?',
	'Beklenmedik anda dans etmeye başlayan kim olur?'
];

// "Yalancı Kim?" modu için yedek trivia soruları. Gerçek cevaplar iyi bilinen,
// tartışmasız genel-kültür bilgileridir (belirsiz olan sayılar "yaklaşık" ile
// belirtildi). Grup kendi sorularını girdiğinde bunlar devreye girmez.
export const DEFAULT_YALANCI_PROMPTS = [
	{ text: 'Ahtapotun kaç kalbi vardır?', answer: '3' },
	{ text: 'Muz botanik olarak neye sınıflandırılır?', answer: 'Meyveye (üzümsü meyve)' },
	{ text: 'Domates botanik olarak meyve midir, sebze midir?', answer: 'Meyvedir' },
	{ text: 'İnsan vücudundaki en sert doku hangisidir?', answer: 'Diş minesi' },
	{
		text: 'Arkeologların bulduğu en eski yenilebilir bal örnekleri yaklaşık kaç yıllıktı?',
		answer: 'Yaklaşık 3000 yıl'
	},
	{
		text: "Tarihin en kısa savaşlarından biri olan İngiltere-Zanzibar Savaşı yaklaşık kaç dakika sürdü?",
		answer: 'Yaklaşık 38 dakika'
	},
	{ text: 'Bir insan günde ortalama kaç kez göz kırpar (yaklaşık)?', answer: 'Yaklaşık 15.000 kez' },
	{
		text: 'Dinlenme halindeki bir yetişkinin kalbi dakikada ortalama kaç kez atar?',
		answer: '60-100 arası'
	}
];
