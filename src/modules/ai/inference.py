"""
modules/ai/inference.py — Inference server cho AI agent (Qwen 2.5 1.5B + LoRA)

Tổng quan:
- Chạy model Qwen 2.5 1.5B với LoRA adapter, 4-bit quantization
- Giao tiếp qua stdin/stdout JSON lines
- Hai mode: tool call (phát hiện ý định) và response (sinh phản hồi)
- Load model một lần, xử lý request tuần tự

Hàm:
- load_model(): Load model + tokenizer với 4-bit quantization, LoRA adapter
- parse_output(text): Parse JSON từ output của model
- infer_tool_call(query, entities_json): Gọi model để xác định tool và params
- infer_response(prompt): Gọi model để sinh text response
- main(): Vòng lặp đọc stdin, xử lý request, ghi stdout
"""
import json, sys, os, traceback
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

BASE_MODEL = "Qwen/Qwen2.5-1.5B"
LORA_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "models", "tiny-llm-lora")
_loaded = False
_model = None
_tokenizer = None

def load_model():
    global _loaded
    if _loaded:
        return
    print("[inference] Loading Qwen 2.5 1.5B base + LoRA adapter with 4-bit quantization...", file=sys.stderr, flush=True)

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    device = "auto" if torch.cuda.is_available() else "cpu"
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb_config if torch.cuda.is_available() else None,
        device_map=device,
    )

    model = PeftModel.from_pretrained(model, LORA_PATH)
    model.eval()

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    tokenizer.pad_token = tokenizer.eos_token

    global _model, _tokenizer
    _model = model
    _tokenizer = tokenizer
    _loaded = True
    print(f"[inference] Model loaded. Device: {model.device}", file=sys.stderr, flush=True)

def parse_output(text):
    text = text.strip()
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        return json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        return {"tool": "unknown", "params": {}}

def infer_tool_call(query, entities_json):
    global _model, _tokenizer
    prompt = (
        f"### Instruction:\n{query}\n\n"
        f"### Input:\n{entities_json}\n\n"
        f"### Response:\n"
    )
    inputs = _tokenizer(prompt, return_tensors="pt").to(_model.device)
    with torch.no_grad():
        outputs = _model.generate(
            **inputs, max_new_tokens=256, do_sample=False,
            pad_token_id=_tokenizer.eos_token_id,
        )
    generated = _tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
    return parse_output(generated)

def infer_response(prompt):
    global _model, _tokenizer
    inputs = _tokenizer(prompt, return_tensors="pt").to(_model.device)
    with torch.no_grad():
        outputs = _model.generate(
            **inputs, max_new_tokens=512, do_sample=False,
            pad_token_id=_tokenizer.eos_token_id,
        )
    generated = _tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
    return generated.strip()

def main():
    load_model()
    print("[inference] Ready", file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)

            if request.get("mode") == "response":
                prompt = request.get("prompt", "")
                text = infer_response(prompt)
                print(json.dumps({"response": text}, ensure_ascii=False), flush=True)
                continue

            query = request.get("query", "")
            entities = request.get("entities", {})
            entities_json = "{}"
            if entities:
                sorted_entities = {k: entities[k] for k in sorted(entities.keys())
                                   if k in entities and entities[k] is not None}
                entities_json = json.dumps(sorted_entities, ensure_ascii=False)

            result = infer_tool_call(query, entities_json)
            print(json.dumps({
                "toolCall": result,
                "intent": result.get("tool", "unknown"),
                "source": "qwen_model",
            }, ensure_ascii=False), flush=True)

        except Exception as e:
            print(json.dumps({
                "toolCall": {"tool": "unknown", "params": {}},
                "intent": "unknown", "source": "qwen_model_error", "error": str(e),
            }, ensure_ascii=False), flush=True)
            traceback.print_exc(file=sys.stderr)
            sys.stderr.flush()

if __name__ == "__main__":
    main()
