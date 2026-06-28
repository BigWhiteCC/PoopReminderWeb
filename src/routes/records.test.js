process.env.JWT_SECRET = 'test-secret-key';

const { formatDurationSec } = require('./records');

describe('formatDurationSec - 时长格式化', () => {
    test('0 秒应显示为 0 秒', () => {
        expect(formatDurationSec(0)).toBe('0 秒');
    });

    test('小于60秒应显示为X秒', () => {
        expect(formatDurationSec(30)).toBe('30 秒');
        expect(formatDurationSec(59)).toBe('59 秒');
    });

    test('60秒应显示为1分', () => {
        expect(formatDurationSec(60)).toBe('1 分');
    });

    test('90秒应显示为1分30秒', () => {
        expect(formatDurationSec(90)).toBe('1 分 30 秒');
    });

    test('120秒应显示为2分', () => {
        expect(formatDurationSec(120)).toBe('2 分');
    });

    test('300秒应显示为5分', () => {
        expect(formatDurationSec(300)).toBe('5 分');
    });

    test('3599秒应显示为59分59秒', () => {
        expect(formatDurationSec(3599)).toBe('59 分 59 秒');
    });

    test('3600秒应显示为60分', () => {
        expect(formatDurationSec(3600)).toBe('60 分');
    });

    test('负数应显示为0秒', () => {
        expect(formatDurationSec(-1)).toBe('0 秒');
        expect(formatDurationSec(-60)).toBe('0 秒');
    });

    test('null应显示为0秒', () => {
        expect(formatDurationSec(null)).toBe('0 秒');
    });

    test('undefined应显示为0秒', () => {
        expect(formatDurationSec(undefined)).toBe('0 秒');
    });

    test('字符串应转换为数字', () => {
        expect(formatDurationSec('300')).toBe('5 分');
    });

    test('小数应取整', () => {
        expect(formatDurationSec(90.5)).toBe('1 分 30 秒');
        expect(formatDurationSec(90.9)).toBe('1 分 30 秒');
    });
});