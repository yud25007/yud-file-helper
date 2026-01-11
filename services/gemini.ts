import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateMissionBriefing = async (
  nameOrPreview: string, 
  type: 'FILE' | 'TEXT'
): Promise<string> => {
  try {
    let prompt = "";
    
    if (type === 'FILE') {
      prompt = `
        你是一名秘密特工联络员。一个名为 "${nameOrPreview}" 的文件刚刚被上传到死信箱。
        请用中文写一句非常简短、酷炫的“任务简报”来描述这个包裹。
        语气要像间谍行动或科幻数据传输。
        例如：“截获来自第七区的加密图纸。” 或 “轨道武器系统的核心代码已锁定。”
        不要包含引号。
      `;
    } else {
      prompt = `
        你是一名秘密特工联络员。一段秘密留言刚刚被加密上传。
        内容片段(仅供参考风格，不要直接复述内容): "${nameOrPreview.substring(0, 20)}..."。
        请用中文写一句非常简短、酷炫的“情报摘要”来描述这条消息。
        语气要神秘、紧迫。
        例如：“收到代号‘夜莺’的紧急加密通讯。” 或 “来自前线的最高机密指令。”
        不要包含引号。
      `;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 } // Speed is priority here
      }
    });

    return response.text || "加密数据包准备就绪。";
  } catch (error) {
    console.error("Gemini mission generation failed:", error);
    return "安全数据已加密并锁定。";
  }
};