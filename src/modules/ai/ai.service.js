const handleCommand = async (req, res) => {
  try {
    const { command } = req.body;
    console.log("AI Command received:", command);
    
    if (!command) {
      return res.status(400).json({ success: false, message: "Vui lòng cung cấp câu lệnh" });
    }

    const systemPrompt = `Bạn là "Bộ phân tích ý định ERP" (ERP Intent Analyzer).
Nhiệm vụ của bạn là nhận câu lệnh tiếng Việt từ người dùng và phân tích ý định của họ, sau đó trả về DUY NHẤT một chuỗi JSON chuẩn (không chứa markdown, không có text dư thừa).
Các intent hỗ trợ:
1. Maps: Dùng để điều hướng trang. Các trang có sẵn: "dashboard", "products", "orders", "customers", "inventory", "reports", "hr", "analytics", "users".
   Cấu trúc trả về: {"intent": "Maps", "payload": {"path": "/tên_trang"}}
2. CREATE_ORDER: Dùng để tạo đơn hàng.
   Cấu trúc trả về: {"intent": "CREATE_ORDER", "payload": {}}
Nếu không khớp intent nào, trả về: {"intent": "UNKNOWN", "payload": {}}

Ví dụ 1: "Cho tôi xem danh sách đơn hàng" -> {"intent": "Maps", "payload": {"path": "/orders"}}
Ví dụ 2: "Mở trang nhân sự" -> {"intent": "Maps", "payload": {"path": "/hr"}}
Ví dụ 3: "Tạo đơn hàng mới" -> {"intent": "CREATE_ORDER", "payload": {}}

Lưu ý: Chỉ trả về chuỗi JSON, không có backticks, không markdown.`;

    const modelName = process.env.OLLAMA_MODEL || "gemma2:9b";
    
    /* 
      NOTE CHO TEAM:
      Ngoài cách gọi Native API (/api/chat) này, Ollama cũng hỗ trợ gọi qua OpenAI SDK.
      Để dùng theo dạng đó:
      client = new OpenAI({
          baseURL: 'http://localhost:11434/v1',
          apiKey: 'ollama', // key tuỳ ý
      })
      MODEL_NAME = "gemma2:9b"
    */

    const ollamaPayload = {
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: command }
      ],
      format: "json", // BẮT BUỘC: Ép Ollama trả về chuẩn JSON thuần tuý
      stream: false
    };

    // Sử dụng Node.js native fetch (Không cần cài thêm axios ở Backend)
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ollamaPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama error (${response.status}): ${errText}`);
    }

    const responseData = await response.json();
    const resultText = responseData.message?.content?.trim() || "{}";
    
    let resultJson;
    try {
      resultJson = JSON.parse(resultText);
    } catch (e) {
      // Đề phòng trường hợp model vẫn cố chấp nhét markdown
      const cleanedText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();
      resultJson = JSON.parse(cleanedText);
    }

    res.status(200).json({ success: true, data: resultJson });
  } catch (error) {
    console.error("AI Command Error:", error);
    
    // Xử lý lỗi đặc thù khi Ollama bị sập / chưa bật
    let errorMsg = error.message;
    if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      errorMsg = "Không thể kết nối đến Ollama Server tại localhost:11434. Vui lòng kiểm tra lại xem Ollama đã chạy chưa.";
    }

    res.status(500).json({ 
      success: false, 
      message: "Lỗi xử lý AI command",
      error: errorMsg
    });
  }
};

module.exports = {
  handleCommand
};
