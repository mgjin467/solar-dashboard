# 태양광 SMP · REC 대시보드

Vercel + Google Drive 기반. 별도 DB를 사용하지 않습니다.

## 원자료
- 발전량: Google Drive의 `발전 보고서 - 년 ...xls`, `발전 보고서 - 월 ...xls`
- SMP: Google Drive의 `smpDataRt_YYYY.xlsx`
- REC 시세: 한국전력거래소 REC 현물시장 OpenAPI(15099762)
- REC 월별/일별 API 조회 성공값: Google Drive `_REC_MARKET_CACHE` 폴더에 Excel로 누적
- REC 수익화 수기입력: Google Drive `_REC_MARKET_CACHE/REC_수익화_수기입력.xlsx`
- 지역/전국 평균: 한국에너지공단 REcloud 공개페이지를 새로고침 시 재확인

## 주요 기능
- 기간: 전체(2023-01-01~현재), 오늘, 전일, 금주, 전주, 당월, 전월, 분기, 반기, 당해, 전해, 직접선택
- 1/2/3년 전 동기간 복수 비교
- 메인 그래프: 막대=수익/발전량, 라인=SMP/설비이용률/발전시간
- 전국·충북 평균 이용률 및 등가 발전시간 비교
- REC 그래프: 막대=발급량/평가금액, 라인=월별 REC 평균가
- REC 평가금액 단가: 현재 REC 단가 또는 사용자가 선택한 특정일(거래 없으면 직전 거래일)
- API로 조회한 특정일 가격은 Drive `REC_현물시장_일별캐시.xlsx`에 저장하여 재호출 방지
- 누적 예상 REC, 누적 수익화 REC, 남은 REC, 누적 수익화 금액 표시
- 월별 수익화 REC/금액 수기 입력 및 Drive 저장/업데이트
- REC 발급신청 마감 D-Day 및 만료 표시

## Vercel 환경변수
```text
GOOGLE_DRIVE_FOLDER_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON={...서비스계정 JSON 전체...}
REC_MARKET_SERVICE_KEY=공공데이터포털 일반인증키
```

로컬에서는 `service_account.json`을 프로젝트 루트에 두고 `.env.local`에:
```text
GOOGLE_DRIVE_FOLDER_ID=...
GOOGLE_SERVICE_ACCOUNT_FILE=./service_account.json
REC_MARKET_SERVICE_KEY=...
```

## Google Drive 권한
REC 캐시와 수익화 수기입력 Excel을 자동 저장하므로 서비스계정 이메일을 대상 Drive 폴더에 **편집자**로 공유해야 합니다.

## 실행
```bash
npm install
npm run dev
```
`http://localhost:3000`

## 지역 평균 참고
REcloud의 월별/지역별 공개표를 매 새로고침 때 확인합니다. 공급기관이 월별/지역별 최신 연도를 아직 공개하지 않은 경우에는 가장 최근 공개 연도 또는 코드 내 공식 공개 fallback을 사용하며, 화면에 기준연도를 표시합니다. 전국 최신 태양광 평균은 REcloud 메인 현황의 최신 분기값을 별도로 표시합니다.

## 추가 기능: 분기 집계 / REC 집계 연동 / 최고·최저 마커

- 상단 `집계`에 `분기`가 추가됩니다.
- 메인 발전 그래프는 시간/일/월/분기/년 단위로 집계할 수 있습니다.
- REC 그래프는 상단 집계 선택을 따라 다음처럼 자동 집계됩니다.
  - `년` 선택 → REC 연간 집계
  - `분기` 선택 → REC 분기 집계
  - `시간/일/월` 선택 → REC 월간 집계
- REC 발급량(또는 평가금액)은 기간 합계로 막대에 표시합니다.
- REC 단가는 분기/년 집계 시 해당 기간에 존재하는 월별 REC 평균가의 산술평균을 라인으로 표시합니다.
- `최고점`, `최저점` 버튼을 각각 켜고 끌 수 있으며 메인 그래프와 REC 그래프의 각 표시 계열에 마커가 추가됩니다.
- 데이터가 없는 미래 구간의 0값은 최고/최저 마커 계산에서 제외합니다.
