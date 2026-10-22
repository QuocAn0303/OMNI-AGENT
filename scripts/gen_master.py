# -*- coding: utf-8 -*-
"""Generate master data for Aduu ERP demo as CSV (Vietnamese)."""
import csv, os, random, datetime

random.seed(20261016)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT  = os.path.dirname(HERE)
OUT  = os.path.join(ROOT, "data", "supermarket")
os.makedirs(OUT, exist_ok=True)

HO = ["Nguyen","Tran","Le","Pham","Hoang","Huynh","Phan","Vu","Vo","Dang","Bui","Do","Ho","Ngo","Duong","Ly","Cao","Dinh","Mai","Truong"]
TEN_NAM = ["Van","Huu","Duc","Minh","Quang","Anh","Hoang","Tuan","Thanh","Hung","Dung","Cuong","Khanh","Bao","Long","Nam","Huy","Hai","Phuc","Tien"]
TEN_NU = ["Thi","Thanh","Thu","Lan","Huong","Mai","Ngoc","Ha","Thao","Yen","Dung","Hong","Nhung","Trang","Linh","Thuy","Hanh","Kim","Chau","Quynh"]
DUONG = ["Nguyen Hue","Le Loi","Hai Ba Trung","Nguyen Trai","Tran Hung Dao","Ly Thuong Kiet","Ho Tung Mau","Phan Chu Trinh","Vo Van Tan","Cach Mang Thang Tam","Dien Bien Phu","Nguyen Thi Minh Khai","Le Thanh Ton","Pasteur","Nam Ky Khoi Nghia"]
PHUONG = ["Binh Tan","Tan Binh","Tan Phu","Go Vap","Phu Nhuan","Binh Thanh","Thu Duc","Quan 1","Quan 3","Quan 5","Quan 7","Quan 10","Quan 11","Quan 12","Hoc Mon","Cu Chi","Nha Be"]

def rnd(a, b): return random.randint(a, b)
def chon(x): return random.choice(x)
def ngay1(y, t, d): return f"{y:04d}-{t:02d}-{d:02d}"
def ean13(n12):
    base = (str(n12) + "0" * 12)[:12]
    s = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(base))
    return base + str((10 - (s % 10)) % 10)

def write_csv(name, rows, cols):
    if not rows: 
        print("  (rong) " + name); return
    fn = os.path.join(OUT, name)
    with open(fn, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=",", quoting=csv.QUOTE_MINIMAL)
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c, "") for c in cols])
    print(f"  {name}: {len(rows)} dong, {os.path.getsize(fn)//1024} KB")

# ---------- 1. CAY NGANH HANG ----------
print("=== CAY NGANH HANG ===")
CAY = [
    ("Thuc pham tuoi song", ["Rau cu tuoi","Trai cay tuoi","Thit heo","Thit ga","Thit bo","Hai san tuoi","Trung"]),
    ("Sua & Do uong", ["Sua tuoi","Sua chua","Sua dau nanh","Nuoc khoang","Tra","Nuoc uong","Cafe"]),
    ("Thuc pham kho & Gia vi", ["Gao & ngu coc","Mi & banh pho","Dau an","Nuoc mam & gia vi","Gia vi","Duong & muoi","Tuong & dưa giac vi"]),
    ("Do an nhanh & Dong lanh", ["Mi goi & thuc pham san","Do an dong lanh","Xuc xich & gio","Banh keo & do ngot"]),
    ("Do gia dung", ["Nuoc rua bat","Bot giat & nuoc giat","Nuoc tay rua","Giay & bong","Dung cu nha bep"]),
    ("Cham soc ca nhan", ["Dau goi & dau xa","Sua tam & xa phong","Cham soc da","Ve sinh rang mieng","Cham soc toc"]),
    ("Me & be", ["Sua cong thuc","Ta giay","Cham soc be"]),
    ("Do uong co con", ["Bia","Rou"]),
    ("Tap hoa & Do an vat", ["Do an vat","Hat & qua kho","Gia vi mang theo"]),
    ("Banh keo & Do an vat", ["Banh keo","Banh quy","Socola","Snack"]),
]
cat_rows = []
for cha, con in CAY:
    cat_rows.append({"name": cha, "parent": "", "group": cha, "is_group": 1})
    for c in con:
        cat_rows.append({"name": c, "parent": cha, "group": cha, "is_group": 0})
write_csv("categories.csv", cat_rows, ["name","parent","group","is_group"])
print(f"  => {len(set(c['name'] for c in cat_rows if c['is_group']==1))} nhom + {len(cat_rows)-len(CAY)} nhom con")

# ---------- 2. NHA CUNG CAP ----------
print("\n=== NHA CUNG CAP ===")
vendors = []
for i in range(60):
    if i % 4 == 0:
        name = "Cong ty CP " + random.choice(["Thuc pham","Nuoc giai khat","Hang tieu dung","Nong san"]) + " " + random.choice(["Viet Nam","Ha Noi","Sai Gon","Dong Nai","Binh Duong"])
    else:
        name = "Cong ty TNHH Thuong mai " + random.choice(["Phuong Nam","Dai Phat","Tan Tien","Hoang Gia","An Phu","Thanh Cong"]) + f" {random.randint(1,99)}"
    vendors.append({
        "vendor_code": f"NCC-{1000+i}",
        "name": name,
        "tax_code": str(random.randint(1000000000, 9999999999)),
        "phone": f"0{random.randint(2,9)}{random.randint(1000000,9999999)}",
        "email": f"contact{i+1}@sup{i%4+1}.com.vn",
        "address": f"{random.randint(1,400)} {random.choice(DUONG)}, {random.choice(PHUONG)}, {random.choice(['TP. HCM','Ha Noi','Da Nang'])}",
        "payment_terms_days": random.choice([0,30,45,60,15]),
        "kraljic": random.choice(["STRATEGIC","LEVERAGE","BOTTLENECK","ROUTINE"]),
        "grade": random.choice(["A","B","C","D"]),
    })
write_csv("vendors.csv", vendors, ["vendor_code","name","tax_code","phone","email","address","payment_terms_days","kraljic","grade"])
print(f"  => {len(vendors)} NCC")

# ---------- 3. KHO & CUA HANG ----------
wh = [{"WH_code":"DC01","name":"Kho trung tam Cu Chi","is_default":1,"parent":"","type":"DC"}]
for i, q in enumerate(["Quan 1","Quan 3","Quan 5","Quan 7","Binh Thanh","Thu Duc","Quan 10","Tan Binh","Binh Duong","Dong Nai"]):
    wh.append({"WH_code": f"CH{i+1:02d}", "name": f"Cua hang Minh Khai {q}", "is_default":0, "parent":"DC01", "type":"STORE"})
write_csv("warehouses.csv", wh, ["WH_code","name","is_default","parent","type"])
print(f"\n=== KHO: {len(wh)} ===")

# ---------- 4. SAN PHAM ----------
print("\n=== SAN PHAM ===")
THUONG_HIEU = [
    "Sua tuoi Vinamilk", "Sua tuoi TH trueMilk", "Sua dau nanh Vinasoy", "Nuoc khoang Aquafina",
    "Nuoc khoang Lavie", "Tra xanh C2", "Cafe G7", "Mi Vifon", "Mi Hao Hao", "Mi Indomie",
    "Bot ngot Ajinomoto", "Nuoc mam Canh", "Dau an Neptune", "Gao ST25", "Gao Hai Hau",
    "Dau an Tuong Oliu", "Banh trung Kinh Do", "Socola Cadbury", "Nuoc rua bat Sunlight",
    "Bot giat OMO", "Nuoc giac Ariel", "Vim nha bep", "Giay ve sinh Pulppy", "Dau goi Dove",
    "Sua tam Nivea", "Kem danh rang Colgate", "Sua cong thuc Friso", "Ta Pampers", "Sua tam be",
    "Bia Saigon", "Heineken", "Snack Oishi", "Hat dieu La Sen", "Xi dau Chinsu",
    "Bot giat My Hao", "Nuoc tay rua Cif", "Kem pho mai Hochland", "Trung ga",
    "Thit heo", "Rau cai", "Trai cay", "Hai san", "Thit ba chi", "Sua chua Vinamilk",
    "Dau goi Clear Men", "Kem chong nang", "Bot giat Tide", "Sua tuoi Vinasoy",
    "Banh san pham", "Mi chua lanh", "Nuoc dua", "Snack tom", "Khoai tay chien",
    "Gia vi knorr", "Bot ngu coc", "Gao Tam Hai", "Nuoc mắm", "Hạt dinh dưỡng",
]
DONVI = ["Goi","Hop","Chai","Hu","Lon","Tuyp","Cay","Tui","Can","Bao","Cai","Khay","Thung","Kg","G","Ml","L"]
NHOM_CAT = {}
for cha, con in CAY:
    for c in con:
        NHOM_CAT[c] = cha
GIA_DEFAULT = (15000, 250000)

def random_weight(product):
    return random.choice(["50g","100g","250g","500g","1kg","2kg","500ml","1L","1.5L","2L","330ml","500ml","100g","180g"])

rows = []
seen_ean = set()
attempts = 0
TARGET = 4000
while len(rows) < TARGET and attempts < TARGET * 5:
    attempts += 1
    brand = random.choice(THUONG_HIEU)
    child = random.choice([c for _, con in CAY for c in con])
    group = next(g for g, con in CAY if child in con)
    conPhu = random.choice(["", " Huong chanh", " Khong duong", " It ngot", " Vi chanh", " Loai 1", " Loai 2", " Tuoi", " Xanh"])
    kl = random.choice(DONVI if random.random() < 0.1 else [""])
    ten = f"{brand}{conPhu} {random.choice(['500g','1L','750ml','180g','250g','1kg','2L','3kg','100g','330ml','180ml'])}".strip()
    lo, hi = (15000, 250000)
    price = random.randint(lo // 100, hi // 100) * 100
    if price <= 0: price = random.randint(lo, hi)
    cost = round(price * random.uniform(0.62, 0.78))
    ean = None
    if random.random() < 0.97:
        for _ in range(5):
            b = ean13(f"893{random.randint(100000000, 999999999)}")
            if b not in seen_ean:
                seen_ean.add(b); ean = b; break
    shelf = random.choice([3, 7, 14, 30, 90, 180, 365, 540, 730]) if random.random() < 0.4 else 365
    rows.append({
        "sku": f"SP{len(rows)+1:06d}",
        "name": ten,
        "unit": random.choice(DONVI),
        "price": price,
        "costPrice": cost,
        "barcode": ean or "",
        "brand": brand.split()[0],
        "group": group,
        "category": child,
        "shelfLifeDays": shelf,
        "trackByLot": "yes" if (group == "Thuc pham tuoi song" or random.random() < 0.2) else "no",
    })

write_csv("products.csv", rows, ["sku","name","unit","price","costPrice","barcode","brand","group","category","shelfLifeDays","trackByLot"])
bc_ok = sum(1 for p in rows if p["barcode"])
bc_bad = 0
for p in rows:
    b = p["barcode"]
    if not b: continue
    s = sum(int(d)*(1 if i%2==0 else 3) for i,d in enumerate(b[:12]))
    if (10-(s%10)) % 10 != int(b[12]): bc_bad += 1
print(f"  san pham: {len(rows)} | co ma vach {bc_ok} ({bc_ok/len(rows)*100:.1f}%) | sai chu so {bc_bad}")

# ============================================================
# 4. KHACH HANG — phan bo that, khong phai ai cung mua 1 don
# ============================================================
PHAN_KHUC = [
    ("Ban le thuong", 0.55, 1, 2, "BRONZE", 1.0),
    ("Thanh vien bac", 0.25, 6, 15, "SILVER", 1.5),
    ("Thanh vien vang", 0.15, 20, 45, "GOLD", 2.0),
    ("Thanh vien kim cuong", 0.05, 60, 150, "PLATINUM", 3.0),
]
HO_NO_MARK = {
    "Nguyen":"nguyen","Tran":"tran","Le":"le","Pham":"pham","Hoang":"hoang",
    "Huynh":"huynh","Phan":"phan","Vu":"vu","Vo":"vo","Dang":"dang","Bui":"bui",
    "Do":"do","Ho":"ho","Ngo":"ngo","Duong":"duong","Ly":"ly","Cao":"cao",
    "Dinh":"dinh","Mai":"mai","Truong":"truong"
}

def ten_nguoi():
    la_nu = random.random() < 0.52
    ho = random.choice(HO)
    ten = random.choice(TEN_NU if la_nu else TEN_NAM)
    return f"{ho} {ten}", ho

customers = []
i = 0
for ten_pk, ty, d_min, d_max, tier, _ in PHAN_KHUC:
    for _ in range(round(5000 * ty)):
        i += 1
        ten, ho = ten_nguoi()
        ho_no = HO_NO_MARK[ho].replace(" ", "")
        customers.append({
            "customer_code": f"KH{100000+i}",
            "name": ten,
            "email": f"{ho_no}{100000+i}@gmail.com",
            "phone": f"09{random.randint(0,9)}{random.randint(1000000,9999999)}",
            "address": f"{random.randint(1,400)} {random.choice(DUONG)}, {random.choice(PHUONG)}, {random.choice(['TP. HCM','Ha Noi','Da Nang'])}",
            "tier": tier,
            "loyalty_points": 0,
            "total_spent": 0,
            "credit_limit": d_max * 200000,
            "num_orders_expected": random.randint(d_min, d_max),
            "phan_khuc": ten_pk,
        })
write_csv("customers.csv", customers, ["customer_code","name","email","phone","address","tier","loyalty_points","total_spent","credit_limit","num_orders_expected","phan_khuc"])
dist = {pk[0]: 0 for pk in PHAN_KHUC}
for c in customers: dist[c["phan_khuc"]] += 1
print(f"  khach hang: {len(customers)}")
for pk in PHAN_KHUC:
    n = dist.get(pk[0], 0)
    n = dist.get(pk[0], 0)
    print("     " + str(pk[0]) + " : " + str(n) + " (" + "{:.1f}".format(n/len(customers)*100) + "%)")
# ============================================================
# 5. README
# ============================================================
with open(os.path.join(OUT, "README.md"), "w", encoding="utf-8") as f:
    f.write("# Bo du lieu chuo sieu thi (mo phong)\n\n")
    f.write("- categories.csv: danh muc cap cha va con\n")
    f.write("- vendors.csv: nha cung cap\n")
    f.write("- warehouses.csv: kho trung tam + cua hang\n")
    f.write("- products.csv: san pham voi EAN-13 hop le\n")
    f.write("- customers.csv: khach hang voi phan phoi so don tuong ung that\n\n")
    f.write("Moi ban ghi deu la du lieu mo phong, danh dau isSynthetic = true.\n")
    f.write("Ma vach sai chu so kiem tra = 0.\n")

print()
print("=" * 70)
print("PRODUCTS  : " + str(len(rows)) + "  | barcode " + str(sum(1 for p in rows if p["barcode"])) + " | barcode sai = " + str(bc_bad))
print(f"CATS     : {len(cat_rows)}")
print(f"VENDOR   : {len(vendors)}")
print(f"WAREHOUSE: {len(wh)}")
print(f"CUSTOMER : {len(customers)}")
print("=" * 70)
print(f"Thu muc output: {OUT}")