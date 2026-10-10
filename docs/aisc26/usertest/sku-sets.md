# Hai bộ SKU cho bài thử (sinh tự động — đừng sửa tay)

> **Nhãn dữ liệu: MÔ PHỎNG.** Dựng từ **UCI Online Retail II — CC BY 4.0**
> (nguồn + sha256 ở `docs/aisc26/02-data.md`). Tên hàng là tên hàng trong tệp công
> khai; giá là **sterling của tập dữ liệu**, không phải giá vốn của bất kỳ doanh
> nghiệp Việt Nam nào. Kịch bản này dùng để **thử quy trình duyệt**, không phải để
> chứng minh hiệu quả trên thị trường.

| Mục | Giá trị |
|---|---|
| Sinh bởi | `npm run usertest:scenario` (`scripts/usertest/build-scenario.js`, **chỉ đọc**) |
| Tenant | `omni-demo-mo-phong` — OMNI DEMO (MÔ PHỎNG — dữ liệu UCI Online Retail II) |
| **Snapshot as-of** | **2026-09-19** |
| Cửa sổ lịch sử nhu cầu | 28 ngày trước as-of |
| Chu kỳ rà soát | 7 ngày |
| Chân trời chấm điểm (P4) | 14 ngày |
| sha256 `sku-sets.json` | `8408c7327359ca31e23d0a1302d0bc55367de994b36c4a60e64670db46311765` |

`⚠` = lead time **ước lượng** (chưa đủ mẫu GRN) — cột này phải nói ra khi hỏi người thử.

## Vì sao có hai bộ

Quy tắc chia: sắp xếp ứng viên theo `orderQty` **tăng dần**, lấy **40 mẫu cách đều**
trên toàn dải (từ SKU đặt ít nhất đến nhiều nhất), rồi **chia xen kẽ**
(A = chỉ số chẵn, B = chỉ số lẻ) ⇒ hai bộ có cùng phân phối `orderQty` và
`demandPerDay`, và cả hai đều trải đều chứ không chỉ gọm SKU bán nhanh.

Hai bộ **cố ý không trùng mã SKU**: nếu trùng, người thử học được bài một rồi làm bài
hai ⇒ đo nhầm trí nhớ thay vì đo tác động của hệ thống.

| So sánh hai bộ | A | B |
|---|---:|---:|
| Số SKU | 20 | 20 |
| Σ `orderQty` | 5.019 | 5.273 |
| TB `orderQty` | 250.95 | 263.65 |
| TB nhu cầu/ngày | 15.9 | 17.85 |
| Σ ước tính tiền | 7.751,47 | 7.697,27 |
| SKU lead time ước lượng | 17 | 19 |
| SKU hết hàng | 0 | 0 |
| **SKU trùng mã giữa hai bộ** | colspan | **0** |

## Cột nào cho người thử, cột nào giữ

- **Điều kiện 1 (đối chứng — không có hệ thống):** chỉ cột *Tồn khả dụng*, *Nhu cầu/ngày*,
  *Lead time*, *Giá vốn*. **Không** cho cột *Hệ thống đề xuất*.
- **Điều kiện 2 (có hệ thống):** thêm cột *Hệ thống đề xuất* + *SS* + *ROP*.
- *Đang trên đường*, *minStock*, *Ước tính tiền* là cột của điều phối — dùng để chấm,
  không nhất thiết đưa hết ra giấy.

### Bộ A — điều kiện 1 của nhóm AB, điều kiện 2 của nhóm BA (20 SKU)

| SKU | Tên | ATP | Đang trên đường | minStock | Nhu cầu/ngày | Lead time (ngày) | SS | ROP | Còn đủ bán (ngày) | **Hệ thống đề xuất** | Ước tính tiền |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 48187 | DOORMAT NEW ENGLAND | 18 | 0 | 26 | 2.08 | 7 ⚠ | 8 | 23 | 8.7 | **20** | 159 |
| 22558 | CLOTHES PEGS RETROSPOT PACK 24 | 72 | 0 | 99 | 4.81 | 7 ⚠ | 59 | 93 | 15 | **55** | 90,75 |
| 21746 | SMALL RED RETROSPOT WINDMILL | 36 | 0 | 40 | 6.5 | 7 ⚠ | 34 | 80 | 5.5 | **90** | 112,5 |
| 22645 | CERAMIC HEART FAIRY CAKE MONEY BANK | 19 | 0 | 38 | 4.03 | 7 ⚠ | 68 | 97 | 4.7 | **107** | 155,15 |
| 21908 | CHOCOLATE THIS WAY METAL SIGN | 36 | 0 | 36 | 9.24 | 7 ⚠ | 36 | 101 | 3.9 | **130** | 273 |
| 21239 | PINK POLKADOT CUP | 19 | 0 | 39 | 9.19 | 7 ⚠ | 36 | 101 | 2.1 | **147** | 124,95 |
| 21231 | SWEETHEART CERAMIC TRINKET BOX | 72 | 0 | 108 | 14.27 | 7 ⚠ | 46 | 146 | 5 | **174** | 217,5 |
| 22661 | CHARLOTTE BAG DOLLY GIRL DESIGN | 37 | 0 | 74 | 13.15 | 7 ⚠ | 47 | 140 | 2.8 | **196** | 166,6 |
| 20679 | EDWARDIAN PARASOL RED | 12 | 0 | 25 | 10.34 | 7 ⚠ | 79 | 152 | 1.2 | **213** | 1.267,35 |
| 22945 | CHRISTMAS METAL TAGS ASSORTED | 72 | 0 | 144 | 16.13 | 7 ⚠ | 86 | 199 | 4.5 | **240** | 204 |
| 22983 | CARD BILLBOARD FONT | 42 | 0 | 48 | 19.14 | 7 ⚠ | 38 | 172 | 2.2 | **264** | 110,88 |
| 71459 | HANGING JAM JAR T-LIGHT HOLDER | 108 | 0 | 192 | 22.38 | 7 ⚠ | 77 | 234 | 4.8 | **283** | 240,55 |
| 22697 | GREEN REGENCY TEACUP AND SAUCER | 54 | 0 | 58 | 20.93 | 7 ⚠ | 73 | 220 | 2.6 | **313** | 923,35 |
| 21136 | PAINTED METAL PEARS ASSORTED | 48 | 0 | 48 | 21.5 | 7 ⚠ | 78 | 229 | 2.2 | **332** | 561,08 |
| 85178 | VICTORIAN SEWING KIT | 20 | 0 | 41 | 21 | 7 ⚠ | 76 | 223 | 1 | **350** | 437,5 |
| 82552 | WASHROOM METAL SIGN | 33 | 0 | 27 | 16.44 | 7 ⚠ | 167 | 283 | 2 | **366** | 530,7 |
| 37340 | MULTICOLOUR SPRING FLOWER MUG | 36 | 0 | 54 | 24 | 7 | 92 | 260 | 1.5 | **392** | 333,2 |
| 22710 | WRAP I LOVE LONDON | 75 | 0 | 75 | 31.25 | 7 ⚠ | 55 | 274 | 2.4 | **418** | 175,56 |
| 47591D | PINK FAIRY CAKE CHILDRENS APRON | 33 | 0 | 55 | 20.08 | 7 | 201 | 342 | 1.6 | **450** | 877,5 |
| 20726 | LUNCH BAG WOODLAND | 37 | 0 | 74 | 31.63 | 7 | 72 | 294 | 1.2 | **479** | 790,35 |

### Bộ B — điều kiện 1 của nhóm BA, điều kiện 2 của nhóm AB (20 SKU)

| SKU | Tên | ATP | Đang trên đường | minStock | Nhu cầu/ngày | Lead time (ngày) | SS | ROP | Còn đủ bán (ngày) | **Hệ thống đề xuất** | Ước tính tiền |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 21936 | RED RETROSPOT PICNIC BAG | 25 | 0 | 51 | 3.88 | 7 ⚠ | 10 | 38 | 6.5 | **41** | 120,95 |
| 21983 | PACK OF 12 BLUE PAISLEY TISSUES | 36 | 0 | 48 | 5.5 | 7 ⚠ | 24 | 63 | 6.5 | **66** | 19,14 |
| 22352 | LUNCH BOX WITH CUTLERY RETROSPOT | 17 | 0 | 34 | 6.83 | 7 ⚠ | 18 | 66 | 2.5 | **97** | 247,35 |
| 22189 | CREAM HEART CARD HOLDER | 27 | 0 | 48 | 8.72 | 7 ⚠ | 23 | 85 | 3.1 | **120** | 474 |
| 23166 | MEDIUM CERAMIC TOP STORAGE JAR | 43 | 0 | 87 | 11.34 | 7 ⚠ | 25 | 105 | 3.8 | **142** | 177,5 |
| 22900 | SET 2 TEA TOWELS I LOVE LONDON | 27 | 0 | 49 | 10.58 | 7 ⚠ | 39 | 114 | 2.6 | **162** | 526,5 |
| 22227 | HANGING HEART MIRROR DECORATION | 27 | 0 | 36 | 12.56 | 7 ⚠ | 34 | 122 | 2.1 | **183** | 118,95 |
| 84406B | CREAM CUPID HEARTS COAT HANGER | 20 | 0 | 41 | 13.03 | 7 ⚠ | 39 | 131 | 1.5 | **203** | 659,75 |
| 22151 | PLACE SETTING WHITE HEART | 72 | 0 | 144 | 17.63 | 7 | 51 | 175 | 4.1 | **227** | 95,34 |
| 20712 | JUMBO BAG WOODLAND ANIMALS | 55 | 0 | 110 | 10.08 | 7 ⚠ | 166 | 237 | 5.5 | **253** | 526,24 |
| 16161U | WRAP SUKI AND FRIENDS | 75 | 0 | 50 | 25 | 7 ⚠ | 0 | 175 | 3 | **275** | 115,5 |
| 21122 | SET/10 PINK POLKADOT PARTY CANDLES | 72 | 0 | 49 | 19.63 | 7 ⚠ | 97 | 235 | 3.7 | **301** | 376,25 |
| 21559 | STRAWBERRY LUNCH BOX WITH CUTLERY | 27 | 0 | 36 | 20.95 | 7 ⚠ | 55 | 202 | 1.3 | **322** | 821,1 |
| 21544 | SKULLS WATER TRANSFER TATTOOS | 36 | 0 | 36 | 22.63 | 7 ⚠ | 58 | 217 | 1.6 | **340** | 289 |
| 21098 | CHRISTMAS TOILET ROLL | 48 | 0 | 100 | 23.81 | 7 ⚠ | 75 | 242 | 2 | **361** | 451,25 |
| 21871 | SAVE THE PLANET MUG | 36 | 0 | 49 | 26.03 | 7 ⚠ | 52 | 235 | 1.4 | **382** | 477,5 |
| 21982 | PACK OF 12 SUKI TISSUES | 42 | 0 | 84 | 28.53 | 7 ⚠ | 50 | 250 | 1.5 | **408** | 118,32 |
| 21930 | JUMBO STORAGE BAG SKULLS | 42 | 0 | 75 | 23.45 | 7 ⚠ | 147 | 312 | 1.8 | **435** | 848,25 |
| 21916 | SET 12 RETRO WHITE CHALK STICKS | 24 | 0 | 49 | 28.86 | 7 ⚠ | 77 | 280 | 0.8 | **459** | 192,78 |
| 22149 | FELTCRAFT 6 FLOWER FRIENDS | 36 | 0 | 52 | 38 | 7 ⚠ | 0 | 266 | 0.9 | **496** | 1.041,6 |

