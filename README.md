# 태양광 발전 · SMP · REC 대시보드

Vercel + Google Drive 기반 대시보드입니다. 별도 DB는 사용하지 않습니다.

## 데이터 흐름

- 발전량: Google Drive의 `발전 보고서 - 년 ...xls`, `발전 보고서 - 월 ...xls`
- SMP: Google Drive에 직접 올린 `smpInLand_YYYY.xlsx` / 연도 포함 SMP Excel
- 지역 평균: 한국에너지공단 REcloud 공개 페이지를 서버에서 새로고침 시 조회
- REC 시세: 공공데이터포털 `한국전력거래소_REC 현물시장 정보` OpenAPI(15099762), 환경변수 키 설정 시 자동 표시

## 인버터 기본 용량

- 인버터1: 99.5 kW
- 인버터2: 99.5 kW
- 합계: 199.0 kW

화면에서 수정하면 브라우저에 저장됩니다.

## 주요 계산식

- 설비이용률(발전효율) = 발전량(kWh) / [설비용량(kW) × 기간시간(h)] × 100
- 등가 발전시간 = 발전량(kWh) / 설비용량(kW)
- 일평균 등가 발전시간 = 등가 발전시간 / 조회일수
- SMP 수익 = 해당 월 발전량 × 해당 월 월평균 SMP
- REC 예상량 = 발전량(MWh) × REC 가중치
- 건축물 등 기존 시설물 이용 태양광 3,000kW 이하 기본 가중치 = 1.5 (실제 설비확인서 우선)

## REC 발급기한

전력공급일이 속한 달의 말일부터 90일 이내 신청해야 합니다. 기한 내 신청을 완료하지 않으면 기한일 익일 자동 말소됩니다.

## 환경변수

```env
GOOGLE_DRIVE_FOLDER_ID=1MqVYFrY4j3yCRJD6hREnqoxNAeDS49p3
GOOGLE_SERVICE_ACCOUNT_FILE=./service_account.json
NEXT_PUBLIC_INVERTER1_KW=99.5
NEXT_PUBLIC_INVERTER2_KW=99.5
REC_MARKET_SERVICE_KEY=
```

Vercel에서는 `GOOGLE_SERVICE_ACCOUNT_FILE` 대신 `GOOGLE_SERVICE_ACCOUNT_JSON`에 서비스계정 JSON 전체를 넣으세요.

REC 시세 자동조회는 공공데이터포털의 아래 API를 활용신청한 뒤 일반 인증키를 `REC_MARKET_SERVICE_KEY`에 넣습니다.

- https://www.data.go.kr/data/15099762/openapi.do

## 지역 평균 자동 비교

새로고침 시 아래 공개 페이지를 다시 읽습니다.

- 충북 월별 이용률: https://recloud.energy.or.kr/rps/present/sub2_1_1.do?engy=1
- 충북 최신 분기 이용률: https://recloud.energy.or.kr/rps/present/sub2_2_1.do?engy=1
- 전국 최신 태양광 이용률: https://recloud.energy.or.kr/rps/main/main01.do
- 건축물 태양광 월별 이용률: https://recloud.energy.or.kr/rps/present/sub2_3_1.do

사이트가 일시적으로 응답하지 않으면 내장된 최근 공개값을 fallback으로 사용합니다.

## 설비이용률(CF) 계산 기준

대시보드의 설비이용률은 다음 두 식이 동일하다는 기준으로 계산합니다.

- 등가 발전시간(h) = 발전량(kWh) / 설비용량(kW)
- 설비이용률(%) = 발전량(kWh) / [설비용량(kW) × 기간시간(h)] × 100
- 따라서 설비이용률(%) = 등가 발전시간(h) / 기간시간(h) × 100
- 하루 기준: 설비이용률(%) = 등가 발전시간 / 24 × 100

`인버터 변환효율(AC/DC)`과 `모듈 변환효율`은 설비이용률과 다른 지표입니다.
