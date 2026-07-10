import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import type { ReservoirFilterType } from './MapModel';

// Style cho mạng lưới sông ngòi động dựa trên cấp độ sông (Cap)
export const riversStyle = (feature: any) => {
  const cap = feature.get('streamOrder') || 6;

  // Sông cấp nhỏ thì nét nhỏ nhạt, cấp lớn thì nét dày rõ
  let mainWidth = 0.5;
  let borderWidth = 1.5;

  if (cap === 1) {
    mainWidth = 3.5;
    borderWidth = 7;
  } else if (cap === 2) {
    mainWidth = 2.2;
    borderWidth = 5;
  } else if (cap === 3) {
    mainWidth = 1.2;
    borderWidth = 3;
  } else {
    mainWidth = 0.5;
    borderWidth = 1.5;
  }

  return [
    new Style({
      stroke: new Stroke({ color: '#1e3a8a', width: borderWidth }) // Viền sông xanh đậm
    }),
    new Style({
      stroke: new Stroke({ color: '#38bdf8', width: mainWidth }) // Lõi sông xanh sáng
    })
  ];
};

export const stationsStyle = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: '#10b981' }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const floodStyle = new Style({
  fill: new Fill({ color: 'rgba(239, 68, 68, 0.25)' }),
  stroke: new Stroke({ color: '#ef4444', width: 1.5 })
});

export const droughtSurveyStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: '#b45309' }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const saltwaterIntrusionStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: '#7c3aed' }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const floodGenerationStyle = new Style({
  fill: new Fill({ color: 'rgba(79, 70, 229, 0.2)' }),
  stroke: new Stroke({ color: '#4f46e5', width: 1.5 })
});

// Bảng màu pastel cho 34 tỉnh thành 2026
export const provinceColors = [
  'rgba(239, 246, 255, 0.55)', // blue-50
  'rgba(254, 242, 242, 0.55)', // red-50
  'rgba(236, 253, 245, 0.55)', // emerald-50
  'rgba(255, 251, 235, 0.55)', // amber-50
  'rgba(245, 243, 255, 0.55)', // violet-50
  'rgba(255, 241, 242, 0.55)', // rose-50
  'rgba(240, 253, 250, 0.55)', // teal-50
  'rgba(254, 252, 232, 0.55)', // yellow-50
  'rgba(238, 242, 255, 0.55)', // indigo-50
  'rgba(255, 247, 237, 0.55)', // orange-50
  'rgba(250, 245, 255, 0.55)', // purple-50
  'rgba(240, 249, 255, 0.55)', // sky-50
  'rgba(254, 249, 195, 0.55)', // yellow-100
  'rgba(252, 231, 243, 0.55)', // pink-100
  'rgba(219, 234, 254, 0.55)', // blue-100
  'rgba(209, 250, 229, 0.55)', // emerald-100
  'rgba(254, 243, 199, 0.55)', // amber-100
  'rgba(237, 233, 254, 0.55)', // violet-100
  'rgba(204, 251, 241, 0.55)', // teal-100
  'rgba(254, 226, 226, 0.55)', // red-100
  'rgba(224, 231, 255, 0.55)', // indigo-100
  'rgba(255, 237, 213, 0.55)', // orange-100
  'rgba(243, 232, 255, 0.55)', // purple-100
  'rgba(224, 242, 254, 0.55)', // sky-100
  'rgba(253, 230, 138, 0.45)', // yellow-200
  'rgba(251, 207, 232, 0.45)', // pink-200
  'rgba(191, 219, 254, 0.45)', // blue-200
  'rgba(167, 243, 208, 0.45)', // emerald-200
  'rgba(253, 230, 138, 0.45)', // amber-200
  'rgba(221, 214, 254, 0.45)', // violet-200
  'rgba(153, 246, 228, 0.45)', // teal-200
  'rgba(254, 202, 202, 0.45)', // red-200
  'rgba(199, 210, 254, 0.45)', // indigo-200
  'rgba(254, 215, 170, 0.45)', // orange-200
];

// Style cho các tỉnh thành (GADM Cấp 1)
export const provincesStyle = (feature: any) => {
  const name = feature.get('NAME_1') || '';
  const idStr = feature.get('GID_1') || '0';
  const idMatch = idStr.match(/\d+/);
  const id = idMatch ? parseInt(idMatch[0], 10) : 0;
  const colorIndex = id % provinceColors.length;

  const geom = feature.getGeometry();
  let labelGeometry = geom;
  if (geom) {
    const geomType = geom.getType();
    if (geomType === 'MultiPolygon') {
      const polygons = geom.getPolygons();
      let maxArea = -1;
      let largestPolygon = polygons[0];
      polygons.forEach((poly: any) => {
        const area = poly.getArea();
        if (area > maxArea) {
          maxArea = area;
          largestPolygon = poly;
        }
      });
      if (largestPolygon) {
        labelGeometry = largestPolygon.getInteriorPoint();
      }
    } else if (geomType === 'Polygon') {
      labelGeometry = geom.getInteriorPoint();
    }
  }

  return [
    new Style({
      fill: new Fill({ color: provinceColors[colorIndex] }),
      stroke: new Stroke({ color: '#4338ca', width: 2.5 }),
    }),
    new Style({
      geometry: labelGeometry,
      text: new Text({
        text: name,
        font: 'bold 12px Inter, system-ui, sans-serif',
        fill: new Fill({ color: '#312e81' }),
        stroke: new Stroke({ color: '#ffffff', width: 4 }),
        overflow: true,
        padding: [2, 4, 2, 4]
      })
    })
  ];
};

export const hashCode = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

// Style cho Phường/Xã (GADM Cấp 3, chỉ hiện nét đứt, nhạt)
export const wardsStyle = (feature: any) => {
  const name = feature.get('NAME_3') || '';
  const gid3 = feature.get('GID_3') || name || '';
  const hue = Math.round((hashCode(gid3) * 137.5) % 360);
  const fillColor = `hsla(${hue}, 65%, 80%, 0.25)`;

  return new Style({
    fill: new Fill({ color: fillColor }),
    stroke: new Stroke({ color: 'rgba(107, 114, 128, 0.4)', width: 1, lineDash: [4, 4] }),
    text: new Text({
      text: name,
      font: 'normal 10.5px Inter, system-ui, sans-serif',
      fill: new Fill({ color: '#374151' }),
      stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
      overflow: false,
      padding: [1, 2, 1, 2]
    })
  });
};

// Style cho các trạm hồ chứa (Cartodiagram): kích thước ~ công suất, màu ~ trạng thái vận hành.
// Đọc bộ lọc hoạt động (reservoirFilter) qua getter để luôn phản ánh giá trị mới nhất.
export function makeDamsStyle(getReservoirFilter: () => ReservoirFilterType) {
  return (feature: any) => {
    const id = feature.get('localId') || 0;
    const wattage = feature.get('ratedPower') || 50;

    // Phân loại trạng thái dựa trên ID
    let status = 'Bình thường';
    let color = '#10b981'; // Xanh lá - Bình thường

    if (id % 5 === 0) {
      status = 'Nguy hiểm';
      color = '#ef4444'; // Đỏ - Nguy hiểm
    } else if (id % 3 === 0) {
      status = 'Xả lũ';
      color = '#f59e0b'; // Vàng/Cam - Xả lũ
    }

    // Lưu trạng thái vào properties để hiển thị trong DynamicPopup
    feature.set('operationalStatus', status);

    // Thực hiện lọc theo bộ lọc hoạt động
    const currentFilter = getReservoirFilter();
    if (currentFilter !== 'all') {
      if (currentFilter === 'binh_thuong' && status !== 'Bình thường') return;
      if (currentFilter === 'xa_lu' && status !== 'Xả lũ') return;
      if (currentFilter === 'nguy_hiem' && status !== 'Nguy hiểm') return;
    }

    // Bán kính vòng tròn tỷ lệ với công suất phát điện: từ 6px đến 18px
    const radius = Math.max(6, Math.min(18, 6 + (wattage / 180)));

    return new Style({
      image: new CircleStyle({
        radius: radius,
        fill: new Fill({ color: color }),
        stroke: new Stroke({ color: '#ffffff', width: 2 })
      })
    });
  };
}

// Style highlight khi click chọn một đoạn sông (dùng cho ol/interaction/Select)
export function makeRiverSelectStyle() {
  return (feature: any) => {
    const cap = feature.get('streamOrder') || 6;

    let mainWidth = 0.5;
    let borderWidth = 1.5;

    if (cap === 1) {
      mainWidth = 3.5;
      borderWidth = 7;
    } else if (cap === 2) {
      mainWidth = 2.2;
      borderWidth = 5;
    } else if (cap === 3) {
      mainWidth = 1.2;
      borderWidth = 3;
    } else {
      mainWidth = 0.5;
      borderWidth = 1.5;
    }

    return [
      new Style({
        stroke: new Stroke({ color: '#fde047', width: borderWidth + 4 }) // Viền ngoài màu vàng sáng (yellow-300)
      }),
      new Style({
        stroke: new Stroke({ color: '#ef4444', width: mainWidth + 2 }) // Lõi màu đỏ (red-500)
      })
    ];
  };
}
