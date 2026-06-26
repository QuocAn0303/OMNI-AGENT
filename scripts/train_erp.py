#!/usr/bin/env python3
"""
train_erp.py — Huan luyen Qwen 2.5 1.5B LoRA adapter cho ERP Aduu
Dua tren QLoRA (4-bit quantized + LoRA) de toi uu GPU memory.

Su dung:
  python train_erp.py --epochs 3 --batch_size 4

Output:
  models/tiny-llm-lora/ — LoRA adapter moi

Training data: sinh tu 15 knowledge documents + db-agent tool handlers
"""

import os, sys, json, argparse
from datasets import Dataset
import torch
from transformers import (
    AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig,
    TrainingArguments, TrainerCallback,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, TaskType
from trl import SFTTrainer

BASE_MODEL = "Qwen/Qwen2.5-1.5B"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "models", "tiny-llm-lora")

# ============================================================
# TRAINING DATA — Generated from ERP knowledge base
# ============================================================

SYSTEM_PROMPT = """Ban la tro ly AI Aduu ERP chuyen mon. Tra loi bang tieng Viet, chinh xac, ngan gon.
Kien thuc: Ke toan VAS/TT200, thue GTGT/TNDN/TNCN, ton kho, workflow duyet, payroll, CRM."""

TRAINING_DATA = [
    # ---- KE TOAN CO BAN ----
    {"prompt": "TK 111 la gi?", "response": "TK 111 la Tai khoan Tien mat — ghi nhan tien mat tai quy. Ben No tang (thu tien), Ben Co giam (chi tien). Day la tai khoan ngan han thuoc nhom TAI SAN."},
    {"prompt": "TK 131 la gi?", "response": "TK 131 la Phai thu khach hang — ghi nhan cac khoan phai thu tu khach hang. Ben No tang khi ban hang chua thu tien, Ben Co giam khi khach hang thanh toan."},
    {"prompt": "TK 331 la gi?", "response": "TK 331 la Phai tra nguoi ban — ghi nhan cac khoan phai tra cho nha cung cap. Ben Co tang khi mua hang chua tra tien, Ben No giam khi thanh toan cho nha cung cap."},
    {"prompt": "TK 511 la gi?", "response": "TK 511 la Doanh thu ban hang — ghi nhan doanh thu tu hoat dong kinh doanh chinh. Ben Co tang (khi ban hang), Ben No giam (ket chuyen cuoi ky sang TK 911)."},
    {"prompt": "TK 632 la gi?", "response": "TK 632 la Gia von hang ban — ghi nhan gia von cua hang hoa da ban. Ben No tang (khi xuat hang), Ben Co giam (ket chuyen cuoi ky sang TK 911)."},
    {"prompt": "TK 642 la gi?", "response": "TK 642 la Chi phi quan ly doanh nghiep — ghi nhan chi phi hanh chinh, luong quan ly, khau hao, thue van phong. Ben No tang (khi phat sinh), Ben Co giam (ket chuyen cuoi ky)."},
    {"prompt": "TK 911 la gi?", "response": "TK 911 la Xac dinh ket qua kinh doanh — dung de ket chuyen doanh thu va chi phi cuoi ky. Ben No nhan chi phi ket chuyen sang, Ben Co nhan doanh thu ket chuyen sang. Chenh lech la lai hoac lo, duoc chuyen sang TK 421."},
    {"prompt": "TK 421 la gi?", "response": "TK 421 la Loi nhuan chua phan phoi — tong hop lai hoac lo sau thue. Ben Co tang khi co lai (No 911/Co 421), Ben No giam khi chia co tuc hoac bu lo."},
    {"prompt": "TK 3331 la gi?", "response": "TK 3331 la Thue GTGT phai nop — thue dau ra thu ho khach hang. Ben Co tang khi ban hang co thue, Ben No giam khi nop thue hoac duoc khau tru. Thue phai nop = 3331 - 1331."},
    {"prompt": "TK 1331 la gi?", "response": "TK 1331 la Thue GTGT duoc khau tru — thue dau vao khi mua hang hoa/dich vu. Ben No tang khi mua hang, Ben Co giam khi khau tru. So du No la thue con duoc khau tru ky sau."},

    # ---- KET CHUYEN CUOI KY ----
    {"prompt": "But toan ket chuyen doanh thu?", "response": "Ket chuyen doanh thu cuoi ky: No cac TK 511, 515, 711 / Co TK 911. But toan nay dua toan bo doanh thu ve TK 911 de xac dinh ket qua. Tong doanh thu phat sinh trong ky duoc ghi ben Co TK 911."},
    {"prompt": "But toan ket chuyen chi phi?", "response": "Ket chuyen chi phi cuoi ky: No TK 911 / Co cac TK 632, 635, 641, 642, 811, 821. But toan nay dua toan bo chi phi ve TK 911. Tong chi phi ghi ben No TK 911."},
    {"prompt": "Ket chuyen lai cuoi ky?", "response": "Neu Co 911 > No 911 (lai): No TK 911 / Co TK 421. Neu No 911 > Co 911 (lo): No TK 421 / Co TK 911. Chenh lech TK 911 sau ket chuyen luon bang 0."},
    {"prompt": "Phan bo chi phi tra truoc?", "response": "Khi tra tien dich vu nhieu thang: No TK 242 / Co TK 112. Moi thang phan bo 1 phan: No TK 642 / Co TK 242. So tien phan bo = Tong tien / So thang. Thuc hien vao ngay dau thang qua cron job."},
    {"prompt": "But toan khau hao TSCD?", "response": "Khau hao TSCD hang thang (phuong phap duong thang): No TK 642 / Co TK 214. Muc khau hao thang = Nguyen gia / So thang su dung. Cron tu dong chay ngay 1 hang thang."},

    # ---- GIA VON ----
    {"prompt": "Tinh gia von hang ban nhu the nao?", "response": "Aduu su dung phuong phap binh quan gia quyen (weighted average cost). Khi nhap hang: costPrice moi = (tonCu x giaCu + nhap x giaMoi) / (tonCu + nhap). Khi xuat ban: COGS = so luong xuat x costPrice hien tai. CostPrice duoc cap nhat sau moi lan nhap hang."},
    {"prompt": "Cong thuc tinh costPrice?", "response": "costPrice = (oldQuantity x oldCost + newQuantity x unitCost) / (oldQuantity + newQuantity). Day la phuong phap binh quan gia quyen lien hoan. Moi lan nhap hang, costPrice duoc tinh lai va luu vao product.costPrice."},

    # ---- THUE ----
    {"prompt": "Tinh thue GTGT?", "response": "Thue GTGT phai nop = VAT dau ra (TK 3331) - VAT dau vao duoc khau tru (TK 1331). Neu VAT vao > VAT ra: so du No 1331 duoc ket chuyen sang ky sau de khau tru tiep. VAT rates: 0%, 5%, 8%, 10%."},
    {"prompt": "Tinh thue TNDN?", "response": "Thue TNDN = Loi nhuan ke toan truoc thue x Thue suat TNDN (thuong la 20%). But toan tinh thue: No TK 821 (Chi phi thue TNDN) / Co TK 3334 (Thue TNDN phai nop). Tinh theo quy (tam tinh) va quyet toan cuoi nam."},
    {"prompt": "Bao cao thue 01/GTGT?", "response": "To khai 01/GTGT gom cac chi tieu: [21] Thue GTGT con duoc khau tru ky truoc, [22] Gia tri mua vao, [23] Thue GTGT mua vao, [29] Doanh thu ban ra, [32] Thue GTGT ban ra, [40] Thue GTGT phai nop = [32] - [23], [41] Thue GTGT duoc hoan."},

    # ---- TON KHO ----
    {"prompt": "Canh bao ton kho thap?", "response": "He thong tu dong canh bao khi quantity <= minStock. Co auto-reorder: khi ton kho cham nguong, he thong tu tao Purchase Order de nhap them hang. Neu PO < 5 trieu VND, tu dong approve. Vendor mac dinh duoc lay tu PO gan nhat cho san pham do."},
    {"prompt": "Cong thuc reorder?", "response": "So luong can nhap = max(1, minStock * 2 - quantity). Vi du: ton kho con 5, minStock = 10 → so luong nhap = max(1, 10*2-5) = 15. Auto-approve neu tong tien PO < 5,000,000 VND."},

    # ---- PAYROLL ----
    {"prompt": "Tinh luong nhan vien?", "response": "Luong thuc nhan = Luong co ban x He so + Phu cap ca - Vi pham - BHXH (8%) - BHYT (1.5%) - BHTN (1%) - Thue TNCN. He thong tu dong tinh luong vao ngay 25 hang thang va tao but toan: No 642 / Co 334, 338, 333."},
    {"prompt": "Tinh thue TNCN?", "response": "Thue TNCN tinh theo bieu luy tien 7 bac. Giam tru ban than: 11 trieu VND/thang. Giam tru nguoi phu thuoc: 4.4 trieu/nguoi/thang. Thu nhap tinh thue = Tong thu nhap - Giam tru. Sau do ap dung bang thue luy tien de tinh so thue phai nop."},

    # ---- WORKFLOW ----
    {"prompt": "Workflow duyet chi phi?", "response": "Khi tao chi phi > 5 trieu VND, he thong tu dong kick hoat workflow EXPENSE_ABOVE. Nguoi duyet duoc phan cong theo step (APPROVAL). Tat ca cac step duyet APPROVED → tu dong approve expense. Neu mot step REJECTED → expense bi tu choi. Xem pending approvals tai /approvals."},
    {"prompt": "Workflow duyet PO?", "response": "Khi submit PO > 10 trieu VND, he thong kich hoat workflow PO_ABOVE. Quy trinh nhieu cap duyet. Neu tat ca duyet APPROVED → PO duoc tu dong approve. Neu co step REJECTED → PO quay lai trang thai truoc."},

    # ---- VIETQR ----
    {"prompt": "VietQR thanh toan?", "response": "He thong ho tro webhook tu Casso/SePay de tu dong xac nhan thanh toan. Khi co giao dich chuyen khoan: match ma don ORD- trong description hoac match amount (±tolerance). Tu dong ghi nhan payment va cap nhat trang thai don hang/cong no. Khach hang co the xem QR thanh toan cong no qua portal."},
    {"prompt": "Portal dat hang?", "response": "Khach hang co the dang nhap portal bang OTP SMS. Sau do co the: (1) Tu dat hang (B2B), (2) Xem cong no va QR thanh toan, (3) Xem diem loyalty va doi thuong, (4) Xem lich su don hang va hoa don dien tu."},

    # ---- REPORT ----
    {"prompt": "Bang can doi so phat sinh?", "response": "CDSPS 6 cot (theo TT200): Du dau ky No | Du dau ky Co | Phat sinh No | Phat sinh Co | Du cuoi ky No | Du cuoi ky Co. Moi TK co 6 cot nay. Tong No dau ky = Tong Co dau ky. Tong PS No = Tong PS Co. Tong No cuoi ky = Tong Co cuoi ky."},
    {"prompt": "Bao cao B02-DN?", "response": "Ket qua kinh doanh 16 dong (theo TT200): (1) DT ban hang, (2) Giam tru DT, (10) DT thuan, (11) GVHB, (20) LN gop, (21) DT tai chinh, (22) CP tai chinh, (23) CP ban hang, (24) CP QLDN, (30) LN thuan HDSXKD, (31) Thu nhap khac, (32) CP khac, (40) LN khac, (50) Tong LN truoc thue, (51) CP thue TNDN, (60) LN sau thue."},
    {"prompt": "Bao cao B01-DN?", "response": "Bang can doi ke toan: TAI SAN = NGUON VON. Tai san ngan han (tien, phai thu, ton kho) + Tai san dai han (TSCD - hao mon) = No phai tra (ngan han + dai han) + Von chu so huu (von gop + LN chua PP). Luon can bang (balanced)."},

    # ---- AGENT TOOLS ----
    {"prompt": "Agent co the tao don hang?", "response": "Co. Ban co the yeu cau: \"tao don hang 5 ao polo cho khach Nguyen Van A\". Agent se: (1) Tim khach hang theo ten, (2) Tim san pham theo ten, (3) Tao order voi trang thai PENDING. Can role ADMIN/MANAGER. Ket qua tra ve ma don hang va tong tien."},
    {"prompt": "Agent co the nhac no?", "response": "Co. Yeu cau: \"nhac no khach Nguyen Van A\". Agent se: (1) Tim khach hang, (2) Tim cong no chua thanh toan, (3) Gui thong bao va tao ghi chu KH. Can role ADMIN/MANAGER."},

    # ---- MORE ACCOUNTING Q&A ----
    {"prompt": "Tai khoan ke toan la gi?", "response": "Tai khoan ke toan la phuong tien de ghi nhan, phan loai va he thong hoa cac nghiep vu kinh te phat sinh. Moi TK co ma so (code), ten goi (name), va loai (type: TAI SAN/NGUON VON/DOANH THU/CHI PHI). TK duoc danh so theo he thong thong nhat cua Bo Tai chinh."},
    {"prompt": "Cong thuc can bang ke toan?", "response": "TAI SAN = NO PHAI TRA + VON CHU SO HUU. Day la phuong trinh ke toan co ban. Luon dung o moi thoi diem. Neu co chech lech, phai kiem tra lai cac but toan. Tong No = Tong Co trong moi but toan."},
    {"prompt": "GVHB la gi?", "response": "Gia Von Hang Ban la chi phi truc tiep de tao ra san pham/ hang hoa da ban. No TK 632 / Co TK 156 (xuat kho). COGS la mot trong nhung chi phi lon nhat, anh huong truc tiep den loi nhuan gop."},
    {"prompt": "Loi nhuan gop la gi?", "response": "Loi nhuan gop = Doanh thu thuan - Gia von hang ban. Chi tieu nay cho biet hieu qua kinh doanh cot loi cua doanh nghiep, truoc khi tru cac chi phi hoat dong khac. Ty le LN gop = LN gop / DT thuan x 100%."},
    {"prompt": "But toan kep la gi?", "response": "But toan kep (double-entry) la phuong phap ghi so ke toan: moi nghiep vu duoc ghi No vao it nhat 1 TK va ghi Co vao it nhat 1 TK, tong so tien No = tong so tien Co. Moi but toan it nhat 2 dong (2 lines)."},
    {"prompt": "Ky ket chuyen la gi?", "response": "Ky ket chuyen la thoi diem cuoi thang/quy/nam de: (1) Ket chuyen doanh thu va chi phi ve TK 911, (2) Xac dinh lai/lo va chuyen sang TK 421, (3) Lap bao cao tai chinh va quyet toan thue. Sau ket chuyen, cac TK 5,6,7,8,9 co so du = 0."},
    {"prompt": "So cai tai khoan?", "response": "So cai la bao cao chi tiet cua 1 tai khoan trong 1 ky, the hien: So du dau ky + Phat sinh No/Co + So du cuoi ky. So cai co them cot TK doi ung (counterpart account) de biet but toan lien quan den TK nao."},
    {"prompt": "So nhat ky chung?", "response": "So Nhat Ky Chung la bao cao liet ke TAT CA cac but toan theo thu tu thoi gian trong 1 ky. Moi dong the hien: Ngay, Ma but toan, Dien giai, TK No, TK Co, So tien. Dung de theo doi va kiem tra toan bo hoat dong ke toan."},
    {"prompt": "Phan biet VAT va TNDN?", "response": "VAT (GTGT) la thue gian thu danh vao tieu dung hang hoa/dich vu, doanh nghiep thu ho nguoi mua roi nop lai NSNN. TNDN la thue truc thu danh vao loi nhuan cua doanh nghiep. VAT tinh theo thang/quy. TNDN tam tinh theo quy, quyet toan nam."},
    {"prompt": "Mua TSCD hạch toan?", "response": "Khi mua TSCD: No TK 211 (Nguyen gia) / No TK 1331 (VAT) / Co TK 112 (TGNH) hoac Co TK 331 (Phai tra NB). Sau do hang thang trich khau hao: No TK 642 / Co TK 214 (Hao mon luy ke)."},
    {"prompt": "Cong thuc tinh lai suat?", "response": "Trong ERP, lai suat thuong duoc tinh cho cac khoan vay. Loi nhuan = Von x Lai suat x Thoi gian. Khi vay: No TK 112 / Co TK 341. Khi tra lai: No TK 635 (CP tai chinh) / Co TK 112. Khi tra goc: No TK 341 / Co TK 112."},
    {"prompt": "Chung tu ke toan?", "response": "Chung tu ke toan la giay to chung minh nghiep vu kinh te phat sinh: Hoa don (ban hang), Phieu thu/chi (tien mat), Phieu nhap/xuat kho, Bang luong, But toan ket chuyen. Trong ERP: moi but toan co ma entryCode, ngay, dien giai, nguoi tao."},
    {"prompt": "Kiem tra can doi?", "response": "Kiem tra can doi: Tong No = Tong Co trong moi but toan. Tong tai san = Tong nguon von trong B01-DN. Tong PS No = Tong PS Co trong CDSPS. Neu co chech lech, kiem tra cac but toan bi loi (thieu dong, sai so tien, sai TK). He thong tu dong validate khi post but toan."},
]

# Tool calling training examples
TOOL_TRAINING = [
    {"prompt": "Tim san pham ao polo", "response": '{"tool": "search_products", "params": {"search": "ao polo"}}'},
    {"prompt": "Doanh thu thang nay", "response": '{"tool": "get_revenue", "params": {"period": "this_month"}}'},
    {"prompt": "Ton kho san pham", "response": '{"tool": "search_inventory", "params": {}}'},
    {"prompt": "Don hang hom nay", "response": '{"tool": "search_orders", "params": {"period": "today"}}'},
    {"prompt": "Khach hang Nguyen Van A", "response": '{"tool": "search_customers", "params": {"search": "Nguyen Van A"}}'},
    {"prompt": "Chi phi thang nay", "response": '{"tool": "search_finance", "params": {"type": "expenses", "period": "this_month"}}'},
    {"prompt": "Nhan su Le Nguyen Quoc An", "response": '{"tool": "search_hr", "params": {"search": "Le Nguyen Quoc An"}}'},
    {"prompt": "Tinh hinh kinh doanh", "response": '{"tool": "get_dashboard", "params": {}}'},
    {"prompt": "Don nhap hang PENDING", "response": '{"tool": "search_purchase_orders", "params": {"status": "PENDING"}}'},
    {"prompt": "Cong no khach hang", "response": '{"tool": "search_debts", "params": {}}'},
    {"prompt": "Hoa don thang nay", "response": '{"tool": "search_invoices", "params": {"period": "this_month"}}'},
    {"prompt": "San pham sap het hang", "response": '{"tool": "search_inventory", "params": {"lowStock": true}}'},
    {"prompt": "Tao don hang", "response": '{"tool": "create_order", "params": {}}'},
    {"prompt": "Nhap them hang", "response": '{"tool": "create_po", "params": {}}'},
    {"prompt": "Nhac no khach", "response": '{"tool": "send_reminder", "params": {}}'},
]

# ============================================================
# DATA GENERATION
# ============================================================

def generate_datasets():
    """Sinh training dataset tu conversational Q&A pairs"""
    conversations = []
    instructions = []

    # Chat format data
    for item in TRAINING_DATA:
        conversations.append({
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": item["prompt"]},
                {"role": "assistant", "content": item["response"]},
            ]
        })

    # Tool calling format data
    for item in TOOL_TRAINING:
        instructions.append({
            "instruction": f"Chon cong cu phu hop va tra ve JSON tool call.",
            "input": item["prompt"],
            "output": item["response"],
        })

    # Convert to HuggingFace datasets
    chat_ds = Dataset.from_list(conversations)
    tool_ds = Dataset.from_list(instructions)

    print(f"[data] Chat dataset: {len(conversations)} examples")
    print(f"[data] Tool dataset: {len(instructions)} examples")
    return chat_ds, tool_ds

# ============================================================
# TRAINING
# ============================================================

def format_chat(example):
    """Format message list thanh chat template cho Qwen"""
    text = ""
    for msg in example["messages"]:
        role = msg["role"]
        content = msg["content"]
        if role == "system":
            text += f"<|im_start|>system\n{content}<|im_end|>\n"
        elif role == "user":
            text += f"<|im_start|>user\n{content}<|im_end|>\n"
        elif role == "assistant":
            text += f"<|im_start|>assistant\n{content}<|im_end|>\n"
    return {"text": text}

def train(args):
    print(f"[train] Loading base model: {BASE_MODEL}")
    print(f"[train] Output dir: {OUTPUT_DIR}")
    print(f"[train] Epochs: {args.epochs}, Batch: {args.batch_size}, LR: {args.lr}")

    # Generate data
    chat_ds, _ = generate_datasets()

    # Format data
    formatted_ds = chat_ds.map(format_chat)
    print(f"[train] Formatted {len(formatted_ds)} examples")

    # Quantization config (QLoRA)
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb_config if torch.cuda.is_available() else None,
        device_map="auto" if torch.cuda.is_available() else "cpu",
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    )
    model = prepare_model_for_kbit_training(model)

    # LoRA config
    lora_config = LoraConfig(
        r=8, lora_alpha=16, target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
        lora_dropout=0.05, bias="none", task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # Tokenizer
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    tokenizer.pad_token = tokenizer.eos_token

    # Training args
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=2,
        learning_rate=args.lr,
        warmup_steps=10,
        logging_steps=5,
        save_strategy="epoch",
        bf16=torch.cuda.is_available(),
        fp16=False,
        optim="paged_adamw_8bit",
        remove_unused_columns=False,
        report_to="none",
    )

    # Trainer
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        args=training_args,
        train_dataset=formatted_ds,
        dataset_text_field="text",
        max_seq_length=512,
    )

    print(f"[train] GPU memory: {torch.cuda.memory_summary() if torch.cuda.is_available() else 'CPU mode'}")
    print("[train] Starting training...")

    trainer.train()

    # Save LoRA adapter
    trainer.model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    print(f"[train] LoRA adapter saved to {OUTPUT_DIR}")
    print("[train] Done! Restart inference server to use new model.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Qwen 2.5 LoRA for ERP Aduu")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=4, help="Batch size per device")
    parser.add_argument("--lr", type=float, default=2e-4, help="Learning rate")
    args = parser.parse_args()

    if not torch.cuda.is_available():
        print("[WARN] No GPU detected! Training on CPU will be very slow.", file=sys.stderr)
        print("[WARN] Recommended: run this script on a machine with CUDA GPU.", file=sys.stderr)

    train(args)
