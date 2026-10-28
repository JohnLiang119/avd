"""avd 內建的 yt-dlp PO Token provider。

向 App 在本機開的 HTTP 伺服器（PoTokenServer，127.0.0.1:4416，介面與
bgutil-ytdlp-pot-provider 相容）取 token。任何失敗一律以「拒絕此請求」回應，
yt-dlp 會照常以不帶 token 的方式繼續（見 OpenSpec android-po-token-provider）。

安裝位置：yt-dlp 的 --plugin-dirs 指向「裝著外掛套件的父目錄」，本檔位於
<父目錄>/avd/yt_dlp_plugins/extractor/ 之下。
"""
from __future__ import annotations

import json
import time

from yt_dlp.extractor.youtube.pot.provider import (
    PoTokenContext,
    PoTokenProvider,
    PoTokenProviderRejectedRequest,
    PoTokenRequest,
    PoTokenResponse,
    register_preference,
    register_provider,
)
from yt_dlp.extractor.youtube.pot.utils import WEBPO_CLIENTS, get_webpo_content_binding
from yt_dlp.networking.common import Request

__version__ = '1.0.0'


@register_provider
class AvdWebViewPTP(PoTokenProvider):
    PROVIDER_VERSION = __version__
    BUG_REPORT_LOCATION = 'App 內建的 provider，請看 logcat 標籤 PoToken'
    # 只以 _request_webpage 連本機伺服器，不對外發請求，因此不需宣告代理等外部請求功能
    _SUPPORTED_EXTERNAL_REQUEST_FEATURES = None
    _SUPPORTED_CLIENTS = WEBPO_CLIENTS
    _SUPPORTED_CONTEXTS = (PoTokenContext.GVS, PoTokenContext.PLAYER, PoTokenContext.SUBS)

    DEFAULT_BASE_URL = 'http://127.0.0.1:4416'
    # 首次鑄造要跑完整 BotGuard（首頁、直譯器、GenerateIT），實測 2～5 秒；給足餘裕
    _TIMEOUT = 40.0
    # 失敗後的退避：yt-dlp 會為每一個格式各要一次 gvs token，伺服器不在時若每次都重試，
    # 一支影片就是 30 次連線。同 bgutil 的作法，失敗後一段時間內回報「不可用」。
    _BACKOFF_SECS = 60.0
    _unavailable_until = 0.0  # 類別層級：同一次 yt-dlp 執行內的所有實例共用

    def is_available(self) -> bool:
        return time.time() >= AvdWebViewPTP._unavailable_until

    def _reject(self, msg: str, cause: Exception | None = None):
        AvdWebViewPTP._unavailable_until = time.time() + self._BACKOFF_SECS
        self.logger.warning(f'{msg}；{int(self._BACKOFF_SECS)} 秒內不再嘗試，改以不帶 token 的方式繼續', once=True)
        raise PoTokenProviderRejectedRequest(msg) from cause

    def _real_request_pot(self, request: PoTokenRequest) -> PoTokenResponse:
        base_url = self._configuration_arg('base_url', default=[self.DEFAULT_BASE_URL])[0]
        content_binding = get_webpo_content_binding(request)[0]
        payload = json.dumps({
            'content_binding': content_binding,
            'bypass_cache': request.bypass_cache,
        }).encode()
        try:
            response = self._request_webpage(
                Request(
                    f'{base_url}/get_pot', data=payload,
                    headers={'Content-Type': 'application/json'},
                    extensions={'timeout': self._TIMEOUT}, proxies={'all': None}),
                note=(f'Generating a {request.context.value} PO Token for '
                      f'{request.internal_client_name} client via App WebView'))
            data = json.load(response)
        except Exception as e:
            self._reject(f'App PO Token provider unavailable: {e!r}', e)

        if data.get('error'):
            self._reject(f'App PO Token provider failed: {data["error"]}')
        po_token = data.get('poToken')
        if not po_token:
            self._reject('App PO Token provider returned no poToken')
        return PoTokenResponse(po_token=po_token)


@register_preference(AvdWebViewPTP)
def avd_webview_preference(provider, request) -> int:
    return 100


__all__ = ['__version__']
