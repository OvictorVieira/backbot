import VersionChecker from './VersionChecker.js';

describe('VersionChecker', () => {
  let versionChecker;

  beforeEach(() => {
    versionChecker = new VersionChecker();
  });

  describe('compareVersions', () => {
    it('deve retornar -1 quando version1 < version2', () => {
      const result = versionChecker.compareVersions('1.5.44', '1.5.45');
      expect(result).toBe(-1);
    });

    it('deve retornar 0 quando version1 = version2', () => {
      const result = versionChecker.compareVersions('1.5.44', '1.5.44');
      expect(result).toBe(0);
    });

    it('deve retornar 1 quando version1 > version2', () => {
      const result = versionChecker.compareVersions('1.5.45', '1.5.44');
      expect(result).toBe(1);
    });
  });

  describe('getVersionDifference', () => {
    it('deve retornar "patch" para diferença de patch', () => {
      const result = versionChecker.getVersionDifference('1.5.45', '1.5.44');
      expect(result).toBe('patch');
    });

    it('deve retornar "minor" para diferença de minor', () => {
      const result = versionChecker.getVersionDifference('1.6.0', '1.5.44');
      expect(result).toBe('minor');
    });

    it('deve retornar "major" para diferença de major', () => {
      const result = versionChecker.getVersionDifference('2.0.0', '1.5.44');
      expect(result).toBe('major');
    });

    it('deve retornar null para versões iguais', () => {
      const result = versionChecker.getVersionDifference('1.5.44', '1.5.44');
      expect(result).toBeNull();
    });
  });
});
