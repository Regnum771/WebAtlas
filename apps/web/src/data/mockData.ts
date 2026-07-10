
export const riversMockData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [108.0, 14.2],
          [108.3, 14.0],
          [108.6, 13.5],
          [109.1, 13.0]
        ]
      },
      properties: {
        id: 'r1',
        name: 'Sông Ba',
        type: 'Sông chính',
        length: '388 km',
        status: 'Bình thường'
      }
    }, 
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [107.5, 14.5],
          [107.8, 14.3],
          [108.2, 14.1]
        ]
      },
      properties: {
        id: 'r2',
        name: 'Sông Sê San',
        type: 'Sông liên quốc gia',
        length: '237 km',
        status: 'Lưu lượng cao'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [107.8, 15.8],
          [108.1, 15.9],
          [108.4, 15.9]
        ]
      },
      properties: {
        id: 'r3',
        name: 'Sông Thu Bồn',
        type: 'Sông chính',
        length: '205 km',
        status: 'Cảnh báo lũ nhẹ'
      }
    }
  ]
};

export const stationsMockData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [108.07, 13.95]
      },
      properties: {
        id: 's1',
        name: 'Trạm Thủy văn An Khê',
        type: 'Đo mực nước',
        status: 'Hoạt động',
        value: 'Mực nước: 2.3m'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [108.44, 15.46]
      },
      properties: {
        id: 's2',
        name: 'Trạm Đo Mưa Phú Ninh',
        type: 'Đo lượng mưa',
        status: 'Hoạt động',
        value: 'Lượng mưa: 45mm/24h'
      }
    }
  ]
};

export const floodMockData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [108.95, 13.05],
          [109.15, 13.05],
          [109.15, 12.95],
          [108.95, 12.95],
          [108.95, 13.05]
        ]]
      },
      properties: {
        id: 'f1',
        name: 'Vùng ngập lụt Tuy Hòa',
        type: 'Nguy cơ ngập',
        area: '15.4 km2',
        riskLevel: 'Trung bình'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [108.40, 15.58],
          [108.55, 15.58],
          [108.55, 15.48],
          [108.40, 15.48],
          [108.40, 15.58]
        ]]
      },
      properties: {
        id: 'f2',
        name: 'Vùng ngập lụt Tam Kỳ',
        type: 'Nguy cơ ngập',
        area: '22.8 km2',
        riskLevel: 'Cao'
      }
    }
  ]
};

export const droughtSurveyMockData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [108.01, 14.01]
      },
      properties: {
        id: 'dr1',
        name: 'Trạm khảo sát hạn hán Pleiku',
        type: 'Khảo sát hạn hán',
        riskLevel: 'Cao',
        status: 'Đang thiếu nước nghiêm trọng',
        surveyDate: '2026-06-15'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [108.80, 13.20]
      },
      properties: {
        id: 'dr2',
        name: 'Điểm khảo sát hạn hán Sông Hinh',
        type: 'Khảo sát hạn hán',
        riskLevel: 'Trung bình',
        status: 'Nguồn nước ngầm suy giảm',
        surveyDate: '2026-06-20'
      }
    }
  ]
};

export const saltwaterIntrusionMockData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [109.28, 13.06]
      },
      properties: {
        id: 'sw1',
        name: 'Cửa sông Đà Diễn (Sông Ba)',
        type: 'Xâm nhập mặn',
        salinity: '4.2 g/l',
        riskLevel: 'Cao',
        status: 'Xâm nhập sâu 5km vào nội đồng'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [109.18, 13.63]
      },
      properties: {
        id: 'sw2',
        name: 'Đầm Thị Nại',
        type: 'Xâm nhập mặn',
        salinity: '3.1 g/l',
        riskLevel: 'Trung bình',
        status: 'Độ mặn tăng cao theo triều cường'
      }
    }
  ]
};

export const floodGenerationMockData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [107.8, 14.3],
          [108.1, 14.3],
          [108.1, 14.0],
          [107.8, 14.0],
          [107.8, 14.3]
        ]]
      },
      properties: {
        id: 'fg1',
        name: 'Lưu vực sinh lũ Thượng nguồn Sông Ba',
        type: 'Vùng sinh lũ',
        riskLevel: 'Cao',
        area: '120 km2',
        flowRate: 'Rất lớn khi mưa lớn'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [107.5, 14.8],
          [107.9, 14.8],
          [107.9, 14.5],
          [107.5, 14.5],
          [107.5, 14.8]
        ]]
      },
      properties: {
        id: 'fg2',
        name: 'Vùng sinh lũ Sa Thầy',
        type: 'Vùng sinh lũ',
        riskLevel: 'Trung bình',
        area: '85 km2',
        flowRate: 'Độ dốc cao, lũ quét nhanh'
      }
    }
  ]
};

export const provincialMockData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [107.4, 13.1],
          [108.8, 13.1],
          [108.8, 14.6],
          [107.4, 14.6],
          [107.4, 13.1]
        ]]
      },
      properties: {
        id: 'p1',
        name: 'Tỉnh Gia Lai',
        type: 'Tỉnh',
        population: '1.5 triệu người'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [107.2, 14.1],
          [108.6, 14.1],
          [108.6, 15.3],
          [107.2, 15.3],
          [107.2, 14.1]
        ]]
      },
      properties: {
        id: 'p2',
        name: 'Tỉnh Kon Tum',
        type: 'Tỉnh',
        population: '540 nghìn người'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [108.6, 12.7],
          [109.3, 12.7],
          [109.3, 13.7],
          [108.6, 13.7],
          [108.6, 12.7]
        ]]
      },
      properties: {
        id: 'p3',
        name: 'Tỉnh Phú Yên',
        type: 'Tỉnh',
        population: '960 nghìn người'
      }
    }
  ]
};

export const districtMockData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [108.0, 13.8],
          [108.3, 13.8],
          [108.3, 14.2],
          [108.0, 14.2],
          [108.0, 13.8]
        ]]
      },
      properties: {
        id: 'dist1',
        name: 'Huyện Đak Đoa',
        type: 'Huyện',
        province: 'Gia Lai'
      }
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [108.7, 13.7],
          [108.95, 13.7],
          [108.95, 14.0],
          [108.7, 14.0],
          [108.7, 13.7]
        ]]
      },
      properties: {
        id: 'dist2',
        name: 'Huyện Tây Sơn',
        type: 'Huyện',
        province: 'Bình Định'
      }
    }
  ]
};

export const layerGroups = [
  {
    id: 'group_admin',
    name: 'Ranh giới hành chính',
    layers: [
      { id: 'layer_provinces_2026', name: 'Ranh giới Tỉnh', defaultVisible: true, opacity: 1 },
      { id: 'layer_wards_2026', name: 'Ranh giới Xã/Phường', defaultVisible: true, opacity: 1 }
    ]
  },
  {
    id: 'group_water_resources',
    name: 'Tài nguyên nước',
    layers: [
      { id: 'layer_dams', name: 'Đập & Hồ chứa', defaultVisible: true, opacity: 1 },
      { id: 'layer_rivers', name: 'Mạng lưới sông ngòi', defaultVisible: true, opacity: 0.8 },
      { id: 'layer_stations', name: 'Trạm quan trắc', defaultVisible: false, opacity: 1 }
    ]
  },
  {
    id: 'group_hazards',
    name: 'Hiểm họa',
    layers: [
      { id: 'layer_flood', name: 'Vùng ngập lụt', defaultVisible: false, opacity: 0.6 },
      { id: 'layer_drought_survey', name: 'Vùng hạn hán', defaultVisible: false, opacity: 0.7 },
      { id: 'layer_saltwater_intrusion', name: 'Xâm nhập mặn', defaultVisible: false, opacity: 0.7 },
      { id: 'layer_flood_generation', name: 'Vùng sinh lũ', defaultVisible: false, opacity: 0.7 }
    ]
  }
];
