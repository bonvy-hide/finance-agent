"""图表响应的统一数据模型"""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ChartResponse(BaseModel):
    """通用图表响应模型

    各类图表接口统一返回此结构，前端通过 chart_type 区分渲染方式：
      - bar       柱状图
      - line      折线图
      - pie       饼图
      - doughnut  环形图
    """

    period: str = Field(..., description="报告期 / 期间")
    title: str = Field("图表", description="图表标题")
    chart_type: str = Field("bar", description="图表类型：bar/line/pie/doughnut")
    labels: List[str] = Field(default_factory=list, description="分类标签")
    values: List[float] = Field(default_factory=list, description="数值序列（亿元）")
    total: float = Field(0.0, description="合计（亿元）")
    groups: Dict[str, float] = Field(default_factory=dict, description="分组明细 {名称: 值}")
    extra: Optional[Dict] = Field(None, description="附加信息（如资产/负债分界点等）")
