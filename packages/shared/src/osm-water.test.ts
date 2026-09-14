import { describe, it, expect } from 'vitest';
import {
  waterwayToStreamOrder,
  osmWaterToLakeType,
  RIVER_WATERWAY_VALUES,
  STREAM_ORDER_LABELS,
} from './osm-water';

describe('ánh xạ OSM waterway -> stream_order', () => {
  it('phân cấp sông chính > kênh > suối > mương', () => {
    expect(waterwayToStreamOrder('river')).toBe(5);
    expect(waterwayToStreamOrder('canal')).toBe(4);
    expect(waterwayToStreamOrder('stream')).toBe(2);
    expect(waterwayToStreamOrder('ditch')).toBe(1);
  });

  it('mương tiêu (drain) cùng hạng với mương dẫn (ditch)', () => {
    expect(waterwayToStreamOrder('drain')).toBe(1);
  });

  it('loại trừ công trình — không phải dòng chảy', () => {
    expect(waterwayToStreamOrder('dam')).toBeNull();
    expect(waterwayToStreamOrder('weir')).toBeNull();
    expect(waterwayToStreamOrder('waterfall')).toBeNull();
  });

  it('không vỡ với tag lạ hoặc thiếu', () => {
    expect(waterwayToStreamOrder('tidal_channel')).toBeNull();
    expect(waterwayToStreamOrder(undefined)).toBeNull();
    expect(waterwayToStreamOrder(null)).toBeNull();
    expect(waterwayToStreamOrder(42)).toBeNull();
  });

  it('RIVER_WATERWAY_VALUES khớp với các giá trị có stream_order', () => {
    expect(RIVER_WATERWAY_VALUES.length).toBeGreaterThan(0);
    for (const v of RIVER_WATERWAY_VALUES) {
      expect(waterwayToStreamOrder(v)).not.toBeNull();
    }
    expect(RIVER_WATERWAY_VALUES).toHaveLength(5);
  });

  it('mỗi bậc đều có nhãn tiếng Việt', () => {
    for (const v of RIVER_WATERWAY_VALUES) {
      const order = waterwayToStreamOrder(v)!;
      expect(STREAM_ORDER_LABELS[order]).toBeTruthy();
    }
    expect(STREAM_ORDER_LABELS[5]).toBe('Sông chính');
  });
});

describe('ánh xạ OSM mặt nước -> lake_type', () => {
  it('nhận diện hồ chứa từ cả landuse lẫn water', () => {
    expect(osmWaterToLakeType({ landuse: 'reservoir' })).toBe('Hồ chứa');
    expect(osmWaterToLakeType({ water: 'reservoir' })).toBe('Hồ chứa');
  });

  it('phân biệt hồ tự nhiên, ao, bể chứa và mặt nước chung', () => {
    expect(osmWaterToLakeType({ water: 'lake' })).toBe('Hồ tự nhiên');
    expect(osmWaterToLakeType({ water: 'pond' })).toBe('Ao');
    expect(osmWaterToLakeType({ water: 'basin' })).toBe('Bể chứa');
    expect(osmWaterToLakeType({ natural: 'water' })).toBe('Mặt nước');
  });

  it('LOẠI dòng chảy vẽ dạng vùng — chúng đã nằm trong layer rivers', () => {
    // water=river là mặt nước của chính con sông đã có tim tuyến; đưa vào layer
    // hồ sẽ khiến một con sông xuất hiện ở cả hai layer.
    expect(osmWaterToLakeType({ natural: 'water', water: 'river' })).toBeNull();
    expect(osmWaterToLakeType({ natural: 'water', water: 'canal' })).toBeNull();
    expect(osmWaterToLakeType({ natural: 'water', water: 'stream' })).toBeNull();
  });

  it('landuse=reservoir thắng water=lake khi cả hai cùng có', () => {
    expect(osmWaterToLakeType({ landuse: 'reservoir', water: 'lake' })).toBe('Hồ chứa');
  });

  it('trả null khi không phải mặt nước', () => {
    expect(osmWaterToLakeType({ building: 'yes' })).toBeNull();
    expect(osmWaterToLakeType({})).toBeNull();
  });
});
