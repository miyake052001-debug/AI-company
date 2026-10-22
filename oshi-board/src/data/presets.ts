import type { Talent } from "@/lib/types";

export interface PresetGroup {
  name: string;
  talents: Talent[];
}

/*
 * 事務所ごとのプリセット。
 * チャンネルID / Twitch ID は公開情報をもとに手入力したもので、変更・卒業などで古くなることがある。
 * 間違っていた場合は「フォロー管理」画面から編集できる（取得エラーのチャンネルには ⚠ が付く）。
 */
const hololive = (id: string, name: string, youtubeChannelId: string): Talent => ({
  id: `holo-${id}`,
  name,
  group: "ホロライブ",
  youtubeChannelId,
});

const nijisanji = (id: string, name: string, youtubeChannelId: string): Talent => ({
  id: `niji-${id}`,
  name,
  group: "にじさんじ",
  youtubeChannelId,
});

const vspo = (id: string, name: string, youtubeChannelId: string, twitchLogin?: string): Talent => ({
  id: `vspo-${id}`,
  name,
  group: "ぶいすぽっ！",
  youtubeChannelId,
  twitchLogin,
});

export const PRESET_GROUPS: PresetGroup[] = [
  {
    name: "ホロライブ",
    talents: [
      hololive("sora", "ときのそら", "UCp6993wxpyDPHUpavwDFqgg"),
      hololive("roboco", "ロボ子さん", "UCDqI2jOz0weumE8s7paEk6g"),
      hololive("miko", "さくらみこ", "UC-hM6YJuNYVAmUWxeIr9FeA"),
      hololive("suisei", "星街すいせい", "UC5CwaMl1eIgY8h02uZw7u8A"),
      hololive("azki", "AZKi", "UC0TXe_LYZ4scaW2XMyi5_kw"),
      hololive("fubuki", "白上フブキ", "UCdn5BQ06XqgXoAxIhbqw5Rg"),
      hololive("matsuri", "夏色まつり", "UCQ0UDLQCjY0rmuxCDE38FGg"),
      hololive("ayame", "百鬼あやめ", "UC7fk0CB07ly8oSl0aqKkqFg"),
      hololive("choco", "癒月ちょこ", "UC1suqwovbL1kzsoaZgFZLKg"),
      hololive("subaru", "大空スバル", "UCvzGlP9oQwU--Y0r9id_jnA"),
      hololive("mio", "大神ミオ", "UCp-5t9SrOQwXMU7iIjQfARg"),
      hololive("okayu", "猫又おかゆ", "UCvaTdHTWBGv3MKj3KVqJVCw"),
      hololive("korone", "戌神ころね", "UChAnqc_AY5_I3Px5dig3X1Q"),
      hololive("pekora", "兎田ぺこら", "UC1DCedRgGHBdm81E1llLhOQ"),
      hololive("flare", "不知火フレア", "UCvInZx9h3jC2JzsIzoOebWg"),
      hololive("noel", "白銀ノエル", "UCdyqAaZDKHXg4Ahi7VENThQ"),
      hololive("marine", "宝鐘マリン", "UCCzUftO8KOVkV4wQG1vkUvg"),
      hololive("kanata", "天音かなた", "UCZlDXzGoo7d44bwdNObFacg"),
      hololive("watame", "角巻わため", "UCqm3BQLlJfvkTsX_hvm0UmA"),
      hololive("towa", "常闇トワ", "UC1uv2Oq6kNxgATlCiez59hw"),
      hololive("luna", "姫森ルーナ", "UCa9Y57gfeY0Zro_noHRVrnw"),
      hololive("lamy", "雪花ラミィ", "UCFKOVgVbGmX65RxO3EtH3iw"),
      hololive("nene", "桃鈴ねね", "UCAWSyEs_Io8MtpY3m-zqILA"),
      hololive("botan", "獅白ぼたん", "UCUKD-uaobj9jiqB-VXt71mA"),
      hololive("polka", "尾丸ポルカ", "UCK9V2B22uJYu3N7eR_BT9QA"),
      hololive("lui", "鷹嶺ルイ", "UCs9_O1tRPMQTHQ-N_L6FU2g"),
      hololive("koyori", "博衣こより", "UC6eWCld0KwmyHFbAqK3V-Rw"),
      hololive("iroha", "風真いろは", "UC_vMYWcDjmfdpH6r4TTn1MQ"),
      hololive("ao", "火威青", "UCMGfV7TVTmHhEErVJg1oHBQ"),
      hololive("kanade", "音乃瀬奏", "UCWQtYtq9EOB4-I5P-3fh8lA"),
      hololive("ririka", "一条莉々華", "UCtyWhCj3AqKh2dXctLkDtng"),
      hololive("raden", "儒烏風亭らでん", "UCdXAk5MpyLD8594lm_OvtGQ"),
      hololive("hajime", "轟はじめ", "UC1iA6_NT4mtAcIII6ygrvCw"),
    ],
  },
  {
    name: "にじさんじ",
    talents: [
      nijisanji("mito", "月ノ美兎", "UCD-miitqNY3nyukJ4Fnf4_A"),
      nijisanji("kaede", "樋口楓", "UCsg-YqdqQ-KFF0LNk23BY4A"),
      nijisanji("rin", "静凛", "UC6oDys1BGgBsIC3WhG1BovQ"),
      nijisanji("kuzuha", "葛葉", "UCSFCh5NL4qXrAy9u-u2lX3g"),
      nijisanji("kanae", "叶", "UCspv01oxUFf_MTSipURRhkg"),
      nijisanji("toya", "剣持刀也", "UCv1fFr156jc65EMiLbaLImw"),
      nijisanji("lize", "リゼ・ヘルエスタ", "UCZ1xuCK1kNmn5RzPYIZop3w"),
      nijisanji("toko", "戌亥とこ", "UCXRlIK3Cw_TJIQC5kSJJQMg"),
      nijisanji("ange", "アンジュ・カトリーナ", "UCHVXbQzkl3rDfsXWo8xi2qw"),
      nijisanji("yuika", "椎名唯華", "UC_4tXjqecqox5Uc05ncxpxg"),
      nijisanji("saku", "笹木咲", "UCoztvTULBYd3WmStqYeoHcA"),
      nijisanji("himawari", "本間ひまわり", "UC0g1AE0DOjBYnLhkgoRWN1w"),
      nijisanji("salome", "壱百満天原サロメ", "UCdpUojq0KWZCN9bxXnZwz5w"),
    ],
  },
  {
    name: "ぶいすぽっ！",
    talents: [
      vspo("sumire", "花芽すみれ", "UCyLGcqYs7RsBb3L0SJfzGYA", "kagasumire"),
      vspo("nazuna", "花芽なずな", "UCiMG6VdScBabPhJ1ZtaVmbw", "nazunakaga"),
      vspo("uruha", "一ノ瀬うるは", "UC5LyYg6cCA4yHEYvtUsir3g"),
      vspo("hinano", "橘ひなの", "UCvUc0m317LWTTPZoBQV479A", "hinanotachiba7"),
      vspo("noah", "胡桃のあ", "UCIcAj6WkJ8vZ7DeJVgmeqKw", "963noah"),
      vspo("met", "小森めと", "UCzUNASdzI4PV5SlqtYwAkKQ", "met_komori"),
      vspo("beni", "八雲べに", "UCjXBuHmWkieBApgBhDuJMMQ", "beni_yakumo"),
      vspo("sena", "空澄セナ", "UCF_U2GCKHvDz52jWdizppIA", "asumisena"),
      vspo("mimi", "兎咲ミミ", "UCnvVG9RbOW3J6Ifqo-zKLiw", "tosakimimi"),
      vspo("runa", "紫宮るな", "UCD5W21JqNMv_tV9nfjvF9sw", "shinomiyaruna"),
    ],
  },
];

const ALL_PRESETS = PRESET_GROUPS.flatMap((g) => g.talents);

/** 初回起動時にフォローしておくメンバー */
const DEFAULT_IDS = [
  "holo-pekora",
  "holo-marine",
  "holo-suisei",
  "holo-miko",
  "holo-fubuki",
  "holo-korone",
  "niji-kuzuha",
  "niji-salome",
  "vspo-sumire",
  "vspo-hinano",
  "vspo-noah",
  "vspo-met",
];

export const DEFAULT_TALENTS: Talent[] = DEFAULT_IDS.map((id) => ALL_PRESETS.find((t) => t.id === id)).filter(
  (t): t is Talent => !!t,
);
