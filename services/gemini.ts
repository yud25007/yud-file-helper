const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_PREFIX = API_BASE_URL ? `${API_BASE_URL}/api` : '/api';

export const generateMissionBriefing = async (
  nameOrPreview: string,
  type: 'FILE' | 'TEXT'
): Promise<string> => {
  try {
    const response = await fetch(`${API_PREFIX}/briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nameOrPreview, type })
    });

    if (!response.ok) {
      throw new Error('Briefing generation failed');
    }

    const data = await response.json();
    return data.briefing || "安全数据已加密并锁定。";
  } catch (error) {
    console.error("Mission briefing generation failed:", error);
    return "安全数据已加密并锁定。";
  }
};
