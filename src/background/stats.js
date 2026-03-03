/**
 * AdEclipse - Stats Tracker
 * Tracks blocked ads, time saved, and data saved
 */

const STATS_KEY = 'adeclipse_stats';
const DAILY_STATS_KEY = 'adeclipse_daily_stats';

// Average ad duration estimates (in seconds)
const AD_DURATIONS = {
  videoAd: 15,
  shortAd: 6,
  bannerAd: 0,
  overlay: 0,
  popup: 2,
  sponsored: 0
};

// Average ad data size estimates (in KB)
const AD_SIZES = {
  videoAd: 2000,
  bannerAd: 150,
  overlay: 50,
  popup: 200,
  sponsored: 100,
  network: 50
};

export class StatsTracker {
  constructor() {
    this.sessionStats = {
      adsBlocked: 0,
      adsSkipped: 0,
      timeSaved: 0,
      dataSaved: 0
    };
    this.pendingUpdates = [];
    this.syncInterval = null;
  }
  
  /**
   * Get all-time stats
   */
  async getStats() {
    try {
      const result = await chrome.storage.local.get([STATS_KEY, DAILY_STATS_KEY]);
      const allTime = result[STATS_KEY] || this.getDefaultStats();
      const daily = result[DAILY_STATS_KEY] || {};
      
      return {
        allTime,
        daily,
        session: this.sessionStats,
        today: await this.getTodayStats()
      };
    } catch (error) {
      console.error('[StatsTracker] Error getting stats:', error);
      return {
        allTime: this.getDefaultStats(),
        daily: {},
        session: this.sessionStats,
        today: this.getDefaultDayStats()
      };
    }
  }
  
  /**
   * Get default stats structure
   */
  getDefaultStats() {
    return {
      adsBlocked: 0,
      adsSkipped: 0,
      timeSaved: 0,
      dataSaved: 0,
      byType: {
        videoAd: 0,
        bannerAd: 0,
        overlay: 0,
        popup: 0,
        sponsored: 0,
        network: 0
      },
      topDomains: {}
    };
  }
  
  /**
   * Get default day stats
   */
  getDefaultDayStats() {
    return {
      date: this.getTodayKey(),
      adsBlocked: 0,
      adsSkipped: 0,
      timeSaved: 0,
      dataSaved: 0
    };
  }
  
  /**
   * Get today's date key
   */
  getTodayKey() {
    return new Date().toISOString().split('T')[0];
  }
  
  /**
   * Get today's stats
   */
  async getTodayStats() {
    try {
      const result = await chrome.storage.local.get(DAILY_STATS_KEY);
      const daily = result[DAILY_STATS_KEY] || {};
      const todayKey = this.getTodayKey();
      
      return daily[todayKey] || this.getDefaultDayStats();
    } catch (error) {
      console.error('[StatsTracker] Error getting today stats:', error);
      return this.getDefaultDayStats();
    }
  }
  
  /**
   * Increment blocked count
   */
  async incrementBlocked(type = 'network', domain = '') {
    try {
      // Update session
      this.sessionStats.adsBlocked++;
      
      // Calculate estimated data saved
      const dataSaved = AD_SIZES[type] || AD_SIZES.network;
      this.sessionStats.dataSaved += dataSaved;
      
      // Queue persistent update
      this.pendingUpdates.push({
        type: 'blocked',
        adType: type,
        domain,
        dataSaved
      });
      
      // Debounced sync
      this.scheduleSync();
    } catch (error) {
      console.error('[StatsTracker] Error incrementing blocked:', error);
    }
  }
  
  /**
   * Record ad skip
   */
  async adSkipped(duration = AD_DURATIONS.videoAd) {
    try {
      // Update session
      this.sessionStats.adsSkipped++;
      this.sessionStats.timeSaved += duration;
      
      // Queue persistent update
      this.pendingUpdates.push({
        type: 'skipped',
        duration
      });
      
      this.scheduleSync();
    } catch (error) {
      console.error('[StatsTracker] Error recording skip:', error);
    }
  }
  
  /**
   * Schedule debounced sync
   */
  scheduleSync() {
    if (this.syncInterval) {
      clearTimeout(this.syncInterval);
    }
    
    this.syncInterval = setTimeout(() => {
      this.sync();
    }, 1000); // Sync after 1 second of inactivity
  }
  
  /**
   * Sync pending updates to storage
   */
  async sync() {
    if (this.pendingUpdates.length === 0) return;
    
    try {
      const updates = [...this.pendingUpdates];
      this.pendingUpdates = [];
      
      const result = await chrome.storage.local.get([STATS_KEY, DAILY_STATS_KEY]);
      const allTime = result[STATS_KEY] || this.getDefaultStats();
      const daily = result[DAILY_STATS_KEY] || {};
      const todayKey = this.getTodayKey();
      
      if (!daily[todayKey]) {
        daily[todayKey] = this.getDefaultDayStats();
      }
      
      for (const update of updates) {
        if (update.type === 'blocked') {
          allTime.adsBlocked++;
          allTime.dataSaved += update.dataSaved;
          allTime.byType[update.adType] = (allTime.byType[update.adType] || 0) + 1;
          
          if (update.domain) {
            allTime.topDomains[update.domain] = (allTime.topDomains[update.domain] || 0) + 1;
          }
          
          daily[todayKey].adsBlocked++;
          daily[todayKey].dataSaved += update.dataSaved;
        } else if (update.type === 'skipped') {
          allTime.adsSkipped++;
          allTime.timeSaved += update.duration;
          
          daily[todayKey].adsSkipped++;
          daily[todayKey].timeSaved += update.duration;
        }
      }
      
      // Clean up old daily stats (keep last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoff = thirtyDaysAgo.toISOString().split('T')[0];
      
      for (const key of Object.keys(daily)) {
        if (key < cutoff) {
          delete daily[key];
        }
      }
      
      await chrome.storage.local.set({
        [STATS_KEY]: allTime,
        [DAILY_STATS_KEY]: daily
      });
    } catch (error) {
      console.error('[StatsTracker] Sync error:', error);
    }
  }
  
  /**
   * Reset all stats
   */
  async reset() {
    try {
      this.sessionStats = {
        adsBlocked: 0,
        adsSkipped: 0,
        timeSaved: 0,
        dataSaved: 0
      };
      
      await chrome.storage.local.set({
        [STATS_KEY]: this.getDefaultStats(),
        [DAILY_STATS_KEY]: {}
      });
    } catch (error) {
      console.error('[StatsTracker] Reset error:', error);
      throw error;
    }
  }
  
  /**
   * Format time for display
   */
  static formatTime(seconds) {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      return `${Math.round(seconds / 60)}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.round((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
  }
  
  /**
   * Format data size for display
   */
  static formatData(kb) {
    if (kb < 1024) {
      return `${Math.round(kb)} KB`;
    } else if (kb < 1024 * 1024) {
      return `${(kb / 1024).toFixed(1)} MB`;
    } else {
      return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
    }
  }
}
