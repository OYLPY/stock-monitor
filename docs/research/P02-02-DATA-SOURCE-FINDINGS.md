# P02-02：美日市场数据与证据来源调研

**查阅日期：2026-11-15**

**范围：**仅核对监管机构、交易所、发行人及政府机构的一手资料；不选择数据供应商，不测试本地产品连接。

## 已核实事实

### 美国：SEC EDGAR

- SEC 的 `data.sec.gov` REST API 提供申报历史和提取的 XBRL 财务数据，无需认证或 API key；数据随申报披露更新，提交历史 API 的典型处理延迟低于 1 秒、XBRL API 低于 1 分钟，但高峰期会变长；批量 ZIP 通常在美东时间凌晨约 3 点每日重建，API 不支持 CORS。[SEC：EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- SEC 说明，EDGAR 接受时间与 SEC.gov 页面首次可见时间不是同一时间；申报通常在 EDGAR 时间戳后 1–3 分钟可见，但繁忙时可能显著延迟，且 SEC 不保证该延迟或提供首次可见时间戳。申报头还分别记录官方 filing date、acceptance date/time。[SEC：Webmaster FAQ](https://www.sec.gov/files/about/webmaster-faq.htm)
- EDGAR 自动访问上限为每秒 10 次（跨所有机器合计）；SEC 要求声明 User-Agent，并保留调整限速及限制访问的权利。部分申报仍以纸件提交，未必能从 EDGAR 获取。[SEC：Developer Resources](https://www.sec.gov/about/developer-resources)、[SEC：Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)

### 日本：EDINET API v2

- 金融厅列出的 EDINET API 规格为 Version 2，官方规格页标记于 2026-06-03 更新。v2 请求必须带 API key；首次申请/签发 API key 需要 EDINET 登录。官方 FAQ 表示 API 免费，不能仅因商业用途而限制，但内容使用仍受 EDINET 规则及日本公共数据利用规则约束。[金融厅：API 资料与规格](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0110.html)、[金融厅：EDINET FAQ](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0090_001.html)
- 当日书类列表从日本时间 08:30 之后原则上每分钟更新；即使内容未变，列表文件也可能被替换。历史列表会有补正、撤回、不公开状态变更和阅览期限到期等更新；规格包含 `submitDateTime`、`processDateTime` 及撤回/公开状态字段。列表中出现的文档也可能在当前已不能下载；HTTP 成功状态不能单独证明文档内容可取。[金融厅：EDINET API v2 规格 PDF](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf)、[金融厅：EDINET FAQ](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0090_001.html)
- EDINET API 的机器获取应走 API；站点条款禁止常规网页抓取，禁止短时间大量访问，并允许金融厅调整、限流或停止 API。使用内容时应按其公共数据利用规则标注来源；修改或加工内容时标明加工事实及主体。[金融厅：EDINET 使用条款](https://disclosure2dl.edinet-fsa.go.jp/guide/static/submit/WZEK0030.html)、[金融厅：EDINET FAQ](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0090_001.html)

### 日本：JPX/TDnet 与交易所行情

- JPX 的公开适时开示服务显示 TDnet 开示日期/时间、公司代码、公司名和标题，并在 TDnet 开示时同步刊载；JPX 网站公开阅览期为 31 天，Listed Company Search 可查过去 10 年，过去 5 年数据库服务为付费服务。[JPX：TDnet 概要](https://www.jpx.co.jp/english/equities/listing/disclosure/tdnet/index.html)
- TDnet API 可按请求直接取得过去 5 年开示资料；JPX 将其列为付费服务，基本月费为 70,000 日元，另按获取量计费。官方 API 测试服务器的 Index API 和 Document API 都返回固定 dummy data。[JPX：TDnet API Service](https://www.jpx.co.jp/english/markets/paid-info-listing/tdnet/02.html)
- JPX 15 分钟延迟行情 API 提供交易日期、最近价格变动时间、最近更新时间、OHLC、成交量及成交额，约每分钟更新；价格信息在 TSE 市场系统发布至少 15 分钟后提供。页面列出每月 80,000 日元基本费及按使用量计费，测试服务器返回三只股票的 dummy data。[JPX：15 Minute-Delayed Stock Price API](https://www.jpx.co.jp/english/markets/paid-info-equities/realtime/06.html)
- JPX 表示取得实时行情通常需要与 TSE 签订合同（存在特定例外），行情费用依数据种类与用途而异；其市场信息政策要求延迟数据显示发生时间，或显著标明数据至少延迟 15 分钟。[JPX：Real-Time Market Data Application](https://www.jpx.co.jp/english/markets/paid-info-equities/realtime/02.html)、[JPX：Market Data Fees](https://www.jpx.co.jp/english/markets/paid-info-equities/realtime/01.html)、[JPX：Market Information Use Policy](https://www.jpx.co.jp/english/markets/paid-info-equities/realtime/tvdivq00000020e5-att/b5b4pj000003wydi.pdf)

### 美国：延迟与历史行情许可

- Nasdaq 的展示政策要求所有延迟数据产品显著显示延迟提示；是否对延迟数据收费取决于具体产品。NYSE 将延迟区间定义为 15 分钟或美东午夜，并要求延迟数据按相应市场数据许可协议使用。[Nasdaq：Display Requirements Policy](https://www.nasdaq.com/content/AdministrationSupport/Policy/DisplayRequirementsPolicy)、[NYSE：Comprehensive Market Data Policies](https://www.nyse.com/publicdocs/nyse/data/NYSE_Proprietary_Market_Data_Comprehensive_Policy_Package.pdf)
- NYSE 对其实时专有行情的“历史再分发”另有政策：在次日美东午夜之后向外部用户再分发，需要 NYSE 授权的特定许可；此前取得延迟使用权并不自动覆盖该历史再分发。[NYSE：Historical Use of Real-Time Proprietary Data](https://www.nyse.com/publicdocs/nyse/data/NYSE_Market_Data_Complete_Policy_Package.pdf)

### 发行人 IR 与官方经济日历

- 发行人 IR 页面可作为该发行人材料的一手出处，但页面结构、日历和更正语义由各发行人维护。示例：Toyota 官方 IR 同时列投资者新闻与投资者日历，并声明日程可能未经通知变更。[Toyota：Investors](https://global.toyota/en/ir/)
- 美国 BLS 日历列出发布时间并注明时间均为美东时间；BEA 表示新闻稿通常在预定时间后数分钟内发布，下一年度日程会提前公布。[BLS：2026 Release Schedule](https://www.bls.gov/schedule/2026/home.htm)、[BEA：Priorities and Schedules](https://www.bea.gov/about/policies-and-information/priorities-and-schedules-posting-content)
- 日本银行公表日程原则上每周五更新，且日期/时间可能变更；内阁府经济社会综合研究所的 GDP 日程也注明安排可能变化，网站可能因运作原因晚于计划时间刊载数据。[BOJ：Release Schedule](https://www.boj.or.jp/en/about/calendar/index.htm)、[ESRI：Quarterly GDP Release Schedule](https://www.esri.cao.go.jp/en/sna/kouhyou/kouhyou_top.html)

## 对 P02-02 的设计含义（基于上述事实的推论）

- 来源记录应区分 `source_published_at`、`source_updated_at`、`observed_at`、`market_time` 和 `scheduled_at`，连同各自时区保存；不能把请求成功时间、EDGAR acceptance time 或日历预定时间当作首次公开时间。
- 监管文件和行情报价应是不同来源类别。SEC/EDINET/TDnet 文件证据至少保留来源 URL、申报/开示标识、版本或更正/撤回状态、获取时间及内容指纹；行情记录另存交易所、证券、币种、行情产品和授权/延迟级别。
- 将来源状态与可用性分开：列表命中不等于文件已成功取得；文档获取失败、撤回或不公开应能表达为未核实/不可用，不得用“有列表记录”冒充已验证内容。
- 用显式产品延迟级别表示 `REAL_TIME`、`DELAYED`、`EOD`、`HISTORICAL`；仅凭本地观察时间推断行情新鲜度不可靠。实际使用前应核对具体产品许可、展示要求及历史再分发权。
- 把交易所测试端点固定样例标为 `DEMO_ONLY`，不得进入正式行情或研究证据。
- 对官方日历保存时区、日程抓取/版本时间和实际首次观察时间；预定时刻到达后仍需实际确认发布。

## 未确认事项

- 本次没有验证本地应用与 SEC、EDINET、JPX 或任何发行人站点的实际连接，也没有检查凭据或授权状态。
- SEC EDGAR 资料范围不是美国股票行情报价；美国具体报价源、历史覆盖、费用与可用许可尚未选定或验证。
- Toyota 仅用于验证“发行人自有 IR 页面”这一来源形态；没有确认所有发行人提供统一 API、稳定字段或相同机器访问条款。
- JPX 的行情 API 与 TDnet API/历史服务存在公开收费条件；本研究仅记录来源属性，没有提出采购或绕过付费限制的方案。
