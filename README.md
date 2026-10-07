# 태양광 SMP 대시보드 — Google Drive Only

이 버전은 KPX 사이트 자동 다운로드를 사용하지 않습니다.

## 운영 방식

1. 발전보고서 Excel을 Google Drive 대상 폴더에 업로드합니다.
2. KPX 사이트에서 연도별 SMP Excel을 직접 다운로드합니다.
3. 같은 Google Drive 폴더에 `smpDataRt_2024.xlsx`, `smpDataRt_2025.xlsx`, `smpDataRt_2026.xlsx`처럼 업로드합니다.
4. 웹앱의 `Drive 데이터 새로고침`을 누릅니다.
5. 같은 연도 SMP 파일이 여러 개면 Google Drive `modifiedTime`이 가장 최신인 파일을 사용합니다.

별도 DB, Vercel 영구 저장소, KPX 자동 다운로드는 사용하지 않습니다.

## Vercel 환경변수

- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

Drive 읽기만 하므로 서비스계정 폴더 권한은 `뷰어`면 충분합니다.

## 그래프

- 오늘/전일/금주/전주/당월/전월/분기/반기/당해/전해/직접선택
- 시간/일/월/년
- 수익/발전량
- 1년전/2년전/3년전 동기간 복수 비교
- 선택 기간의 끝까지 데이터가 없는 구간도 0으로 표시
- 그래프 휠/터치 확대축소 및 이동
- 좌우 축 숫자가 잘리지 않도록 차트 여백 자동 확보


## SMP 계산 기준
- 각 월의 SMP는 **그 달 15일의 시간별 SMP를 산술평균한 값**을 대표 단가로 사용합니다.
- 해당 대표 단가를 그 달 전체 발전량의 수익 계산에 적용합니다.
- 15일 데이터가 없는 월만 기존 fallback 월값을 사용합니다.
