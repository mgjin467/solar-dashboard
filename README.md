# 태양광 발전 · SMP · REC 대시보드

Google Drive 발전보고서/SMP Excel + 한국전력거래소 REC 현물시장 OpenAPI를 사용하는 Next.js/Vercel 대시보드입니다.

## 환경변수

```text
GOOGLE_DRIVE_FOLDER_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON={...}
REC_MARKET_SERVICE_KEY=공공데이터포털_일반인증키
```

로컬에서는 `GOOGLE_SERVICE_ACCOUNT_FILE=./service_account.json`도 사용할 수 있습니다.

## REC API

공공데이터포털 **한국전력거래소_REC 현물시장 정보(15099762)** 를 사용합니다.

- Endpoint: `https://apis.data.go.kr/B552115/RecMarketInfo2/getRecMarketInfo2`
- 필수 파라미터: `serviceKey`, `pageNo`, `numOfRows`, `dataType=json`, `bzDd=YYYYMMDD`
- Vercel에는 승인받은 키를 `REC_MARKET_SERVICE_KEY`로 등록한 뒤 Redeploy 합니다.
- 대시보드는 선택기간이 12개월 이하일 때 각 월의 월말 기준 최근 화/목 장운영일을 역조회해 **그 달 마지막 확인 가능한 REC 현물시장 육지 평균가**를 라인그래프로 표시합니다.
- 개발계정 일일 100건 제한을 고려해 REC 가격 자동조회는 최대 최근 12개월로 제한합니다.

## REC 그래프

- 막대: `예상 REC 발급량 = 발전량(MWh) × 가중치`
- 라인: 해당 월 마지막 확인 가능한 거래일의 `육지 REC 평균가(원/REC)`
- 표: 월별 발전량, 예상 REC, 가격 기준 거래일, 예상 REC 금액, 발급신청 마감일

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속합니다.


## REC API 호출 절약 / Google Drive 누적 캐시

REC 현물시장 API는 호출량 제한이 있으므로 조회 성공한 월별 가격은 Google Drive에 영구 저장합니다.

- Drive 폴더: `_REC_MARKET_CACHE`
- 파일: `REC_현물시장_월별캐시.xlsx`
- 저장 컬럼: 월, 가격기준일, 육지평균가, 고가, 저가, 종가, 거래량, 거래건수, 캐시저장시각
- 이미 저장된 **과거 월은 API를 다시 호출하지 않습니다.**
- **현재 월만** 사용자가 `Drive 데이터 새로고침`을 눌렀을 때 최신 거래일 가격으로 다시 확인하고 같은 Excel을 갱신합니다.
- 한 요청에서 최대 API 호출을 88회로 제한하여 개발계정 일일 100건 한도에 여유를 둡니다.
- Drive에 캐시 파일을 생성/갱신하려면 서비스계정을 대상 Drive 폴더에 **편집자**로 공유해야 합니다. 읽기만 가능한 뷰어 권한이면 API 조회는 되지만 캐시 영구 저장은 실패합니다.
