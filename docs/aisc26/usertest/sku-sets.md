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
| **Snapshot as-of** | **2026-10-03** |
| Cửa sổ lịch sử nhu cầu | 28 ngày trước as-of |
| Chu kỳ rà soát | 7 ngày |
| Chân trời chấm điểm (P4) | 14 ngày |
| sha256 `sku-sets.json` | `a83edf05017313333347324b63669653421bb153b9c385704f6d0fd3813f4b23` |

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
| Σ `orderQty` | 5.243 | 5.462 |
| TB `orderQty` | 262.15 | 273.1 |
| TB nhu cầu/ngày | 16.01 | 16.65 |
| Σ ước tính tiền | 10.742,26 | 8.419,34 |
| SKU lead time ước lượng | 19 | 20 |
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
| 16046 | TEATIME PEN CASE & PENS | 9 | 0 | 96 | 2 | 7 ⚠ | 0 | 14 | 4.5 | **19** | 16,15 |
| 21535 | RED RETROSPOT SMALL MILK JUG | 24 | 0 | 28 | 6.11 | 7 ⚠ | 17 | 60 | 3.9 | **79** | 201,45 |
| 21114 | LAVENDER SCENTED FABRIC HEART | 17 | 0 | 35 | 7.94 | 7 ⚠ | 16 | 72 | 2.1 | **111** | 138,75 |
| 21976 | PACK OF 60 MUSHROOM CAKE CASES | 27 | 0 | 55 | 8.05 | 7 ⚠ | 40 | 97 | 3.4 | **127** | 69,85 |
| 21623 | VINTAGE UNION JACK MEMOBOARD | 6 | 0 | 15 | 6.23 | 7 ⚠ | 66 | 110 | 1 | **148** | 1.472,6 |
| 21672 | WHITE SPOT RED CERAMIC DRAWER KNOB | 42 | 0 | 48 | 11.67 | 7 ⚠ | 42 | 124 | 3.6 | **164** | 205 |
| 22536 | MAGIC DRAWING SLATE PURDEY | 39 | 0 | 75 | 11 | 7 ⚠ | 70 | 147 | 3.5 | **185** | 77,7 |
| 22273 | FELTCRAFT DOLL MOLLY | 18 | 0 | 24 | 12.25 | 7 ⚠ | 46 | 132 | 1.5 | **200** | 590 |
| 48187 | DOORMAT NEW ENGLAND | 18 | 0 | 26 | 11.52 | 7 ⚠ | 65 | 146 | 1.6 | **209** | 1.661,55 |
| 22908 | PACK OF 20 NAPKINS RED APPLES | 36 | 0 | 48 | 12.56 | 7 ⚠ | 96 | 184 | 2.9 | **236** | 200,6 |
| 21982 | PACK OF 12 SUKI TISSUES | 42 | 0 | 84 | 17.5 | 7 ⚠ | 66 | 189 | 2.4 | **270** | 78,3 |
| 22150 | 3 STRIPEY MICE FELTCRAFT | 24 | 0 | 37 | 18.4 | 7 ⚠ | 66 | 195 | 1.3 | **300** | 585 |
| 21136 | PAINTED METAL PEARS ASSORTED | 48 | 0 | 48 | 20.94 | 7 ⚠ | 67 | 214 | 2.3 | **313** | 528,97 |
| 22710 | WRAP I LOVE LONDON | 75 | 0 | 75 | 25.98 | 7 ⚠ | 51 | 233 | 2.9 | **340** | 142,8 |
| 22537 | MAGIC DRAWING SLATE DINOSAUR | 24 | 0 | 48 | 21.92 | 7 ⚠ | 88 | 242 | 1.1 | **372** | 156,24 |
| 22645 | CERAMIC HEART FAIRY CAKE MONEY BANK | 19 | 0 | 38 | 22.05 | 7 ⚠ | 96 | 251 | 0.9 | **387** | 561,15 |
| 20983 | 12 PENCILS TALL TUBE RED RETROSPOT | 18 | 0 | 36 | 22.91 | 7 ⚠ | 105 | 266 | 0.8 | **409** | 347,65 |
| 22630 | DOLLY GIRL LUNCH BOX | 46 | 0 | 92 | 27.57 | 7 ⚠ | 94 | 287 | 1.7 | **434** | 846,3 |
| 23245 | SET OF 3 REGENCY CAKE TINS | 75 | 0 | 74 | 29.88 | 7 ⚠ | 111 | 321 | 2.5 | **456** | 2.257,2 |
| 75049L | LARGE CIRCULAR MIRROR MOBILE | 97 | 0 | 195 | 23.73 | 7 | 247 | 414 | 4.1 | **484** | 605 |

### Bộ B — điều kiện 1 của nhóm BA, điều kiện 2 của nhóm AB (20 SKU)

| SKU | Tên | ATP | Đang trên đường | minStock | Nhu cầu/ngày | Lead time (ngày) | SS | ROP | Còn đủ bán (ngày) | **Hệ thống đề xuất** | Ước tính tiền |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20759 | CHRYSANTHEMUM POCKET BOOK | 6 | 0 | 12 | 2.63 | 7 ⚠ | 20 | 39 | 2.3 | **52** | 44,2 |
| 72351B | SET/6 PINK BUTTERFLY T-LIGHTS | 18 | 0 | 36 | 5.93 | 7 ⚠ | 24 | 66 | 3 | **90** | 189 |
| 21385 | IVORY HANGING DECORATION HEART | 72 | 0 | 52 | 10.21 | 7 ⚠ | 44 | 116 | 7 | **116** | 98,6 |
| 21786 | POLKADOT RAIN HAT | 18 | 0 | 51 | 8.56 | 7 ⚠ | 38 | 98 | 2.1 | **140** | 110,6 |
| 22297 | HEART IVORY TRELLIS SMALL | 72 | 0 | 65 | 12.21 | 7 ⚠ | 54 | 140 | 5.9 | **154** | 192,5 |
| 48138 | DOORMAT UNION FLAG | 30 | 0 | 40 | 10.27 | 7 ⚠ | 58 | 130 | 2.9 | **172** | 1.367,4 |
| 21974 | SET OF 36 PAISLEY FLOWER DOILIES | 36 | 0 | 36 | 12.88 | 7 ⚠ | 43 | 134 | 2.8 | **189** | 274,05 |
| 15056BL | EDWARDIAN PARASOL BLACK | 18 | 0 | 60 | 11.47 | 7 ⚠ | 62 | 143 | 1.6 | **206** | 1.225,7 |
| 35961 | FOLKART ZINC HEART CHRISTMAS DEC | 23 | 0 | 47 | 12.39 | 7 ⚠ | 63 | 150 | 1.9 | **214** | 181,9 |
| 22348 | TEA BAG PLATE RED RETROSPOT | 39 | 0 | 49 | 16.05 | 7 ⚠ | 65 | 178 | 2.4 | **252** | 214,2 |
| 22602 | CHRISTMAS RETROSPOT HEART WOOD | 42 | 0 | 57 | 18.86 | 7 ⚠ | 65 | 197 | 2.2 | **287** | 243,95 |
| 22563 | HAPPY STENCIL CRAFT | 18 | 0 | 37 | 17.28 | 7 ⚠ | 79 | 200 | 1 | **303** | 378,75 |
| 82581 | TOILET METAL SIGN | 36 | 0 | 39 | 17.75 | 7 ⚠ | 111 | 236 | 2 | **325** | 178,75 |
| 22662 | LUNCH BAG DOLLY GIRL DESIGN | 45 | 0 | 54 | 20.87 | 7 ⚠ | 103 | 250 | 2.2 | **352** | 580,8 |
| 84692 | BOX OF 24 COCKTAIL PARASOLS | 75 | 0 | 82 | 24.86 | 7 ⚠ | 105 | 280 | 3 | **380** | 159,6 |
| 22367 | CHILDRENS APRON SPACEBOY DESIGN | 30 | 0 | 40 | 21.5 | 7 ⚠ | 123 | 274 | 1.4 | **395** | 770,25 |
| 22549 | PICTURE DOMINOES | 20 | 0 | 40 | 24.41 | 7 ⚠ | 107 | 278 | 0.8 | **429** | 622,05 |
| 16156S | WRAP PINK FAIRY CAKES | 75 | 0 | 100 | 31.82 | 7 ⚠ | 71 | 294 | 2.4 | **442** | 185,64 |
| 21671 | RED SPOT CERAMIC DRAWER KNOB | 39 | 0 | 48 | 24.93 | 7 ⚠ | 162 | 337 | 1.6 | **473** | 591,25 |
| 22558 | CLOTHES PEGS RETROSPOT PACK 24 | 72 | 0 | 99 | 28.04 | 7 ⚠ | 169 | 366 | 2.6 | **491** | 810,15 |

