/**
 * 文字語言的啟發式判斷。
 *
 * 搜尋結果的 flat 資料沒有可靠的官方語言欄位（實測 `language`／
 * `audio_language` 皆空，YouTube 多數影片本就沒填），逐支完整解析
 * 又要一支一次請求。故以字元組成判斷，純函式、零網路請求（design D8）。
 */

/** 中日韓表意文字（基本區、擴充 A、相容表意文字）。 */
const CJK_IDEOGRAPH_RE = /[㐀-䶿一-鿿豈-﫿]/;

/** 日文假名（平假名、片假名、片假名語音擴充、半形片假名）。 */
const KANA_RE = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;

/** 韓文諺文（字母、相容字母、音節）。 */
const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/**
 * 文字是否「看起來是中文」：含表意文字、且不含假名與諺文。
 *
 * 已知誤差並接受（design D8）：純漢字標題的日文影片會誤判為中文；
 * 中文內容配純英文標題者會漏判（呼叫端以標題＋頻道名合併判斷來補強）。
 */
export function looksChinese(text: string): boolean {
  const t = text || '';
  return CJK_IDEOGRAPH_RE.test(t) && !KANA_RE.test(t) && !HANGUL_RE.test(t);
}
