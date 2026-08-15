"""图表响应的统一数据模型"""

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


# ChartResponse 支持的图表类型枚举
# bar       - 柱状图
# line      - 折线图
# pie       - 饼图
# doughnut  - 环形图
# mixed     - 柱+折线混合图（双 y 轴）
CHART_TYPES = ("bar", "line", "pie", "doughnut", "mixed")


class ChartResponse(BaseModel):
    """通用图表响应模型

    各类图表接口统一返回此结构，前端通过 chart_type 区分渲染方式：
      - bar       柱状图（单数据序列）
      - line      折线图（单或多数据序列）
      - pie       饼图
      - doughnut  环形图
      - mixed     柱+折线混合图（双 y 轴，用于成本/费用对比类图表）

    extra 字段约定（按 chart_type 不同）：
      - bar/line/pie/doughnut：自由结构（如 bs_chart 的 asset_count/raw_rows_count）
      - mixed：包含以下子字段以驱动前端双轴渲染：
          series: List[{
              name:        str          序列名称
              type:        "bar"|"line" 序列类型
              y_axis:      "left"|"right"  绑定的 y 轴
              data:        List[float]  数据（与 labels 等长）
              color:       str          颜色（hex）
              unit:        str          单位（如 "亿"、"%"）
          }]
          scales: {
              left:  { title: str, unit: str }
              right: { title: str, unit: str }
          }
          unit: str  主单位（用于 tooltip/x 轴 tick 显示）
      - line（多序列）：可使用 extra.series: List[{name, data, color}] 复用前端多线渲染
    """

    period: str = Field(..., description="报告期 / 期间")
    title: str = Field("图表", description="图表标题")
    chart_type: str = Field("bar", description=f"图表类型：{'/'.join(CHART_TYPES)}")
    labels: List[str] = Field(default_factory=list, description="分类标签（x 轴）")
    values: List[Optional[float]] = Field(default_factory=list, description="数值序列（主序列，向后兼容；缺失值用 None 表示，前端渲染时断点跳过）")
    total: float = Field(0.0, description="合计（亿元）")
    groups: Dict[str, float] = Field(default_factory=dict, description="分组明细 {名称: 值}")
    extra: Optional[Dict[str, Any]] = Field(None, description="附加信息（结构随 chart_type 变化，见类 docstring）")


class NormalizeResponse(BaseModel):
    """标准化数据转换响应模型

    POST /api/normalize 返回此结构，前端持有 data_id 后并发请求 6 个图表端点。

    rows 中每行对应一个报告期，长度 = len(columns)。
    首列为日期字符串（YYYY-MM-DD），其余为 float 或 None。
    """

    data_id: str = Field(..., description="标准化数据的缓存 ID，用于后续图表端点查询")
    company_name: str = Field("", description="公司名称（用户上传时输入，用于图表标题）")
    source_file: str = Field("", description="原始文件名")
    periods: List[str] = Field(default_factory=list, description="报告期列表 (YYYY-MM-DD)，升序")
    columns: List[str] = Field(default_factory=list, description="列名列表，与 finance.stock_normalize.OUTPUT_COLUMNS 一致")
    rows: List[List[Union[str, float, None]]] = Field(default_factory=list, description="数据行（每行首列为日期字符串 YYYY-MM-DD，其余为 float 或 None）")
    meta: Dict[str, Any] = Field(default_factory=dict, description="元信息（period_count/column_count/ttm_columns/new_columns 等）")
