class TimezoneHelper {
    constructor() {
      // Popular timezones for UI (TOP 10 ONLY)
      this.popularTimezones = [
        'UTC',
        'Europe/Warsaw',
        'Europe/London', 
        'Europe/Berlin',
        'America/New_York',
        'America/Los_Angeles',
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Australia/Sydney',
        'America/Toronto'
      ];

      // Cache for performance
      this._timezoneListCache = null;
      this._allTimezonesCache = null;
    }

    /**
     * Get all available system timezones
     */
    getAllSystemTimezones() {
      if (this._allTimezonesCache) {
        return this._allTimezonesCache;
      }

      try {
        // Node 18+ built-in function
        if (typeof Intl.supportedValuesOf === 'function') {
          this._allTimezonesCache = Intl.supportedValuesOf('timeZone');
          return this._allTimezonesCache;
        }
      } catch (error) {
        console.warn('Intl.supportedValuesOf not available:', error.message);
      }

      // Fallback: return popular timezones
      this._allTimezonesCache = this.popularTimezones;
      return this._allTimezonesCache;
    }

    /**
     * Check if timezone is valid
     */
    isValidTimezone(timezone) {
      if (!timezone) return false;
      
      try {
        // Quick way to check timezone support
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    }

    /**
     * Get a nice timezone name
     */
    getTimezoneLabel(timezone) {
      if (!timezone) return 'Unknown Timezone';
      
      if (timezone === 'UTC') {
        return 'UTC (Coordinated Universal Time)';
      }

      try {
        // Get city name
        const city = timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
        
        // Get offset
        const offset = this.getTimezoneOffset(timezone);
        
        // Get short name (e.g. CET, EST)
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          timeZoneName: 'short'
        });
        
        const parts = formatter.formatToParts(now);
        const shortName = parts.find(part => part.type === 'timeZoneName')?.value;
        
        if (shortName && shortName !== timezone) {
          return `${shortName} (${city}) ${offset}`;
        }
        
        // Fallback if we couldn't get a short name
        return `${city} ${offset}`;
        
      } catch (error) {
        // Last fallback
        return timezone.replace(/_/g, ' ');
      }
    }

    /**
     * Get UTC offset of timezone
     */
    getTimezoneOffset(timezone) {
      try {
        const now = new Date();
        
        // Get the timezone offset using a more reliable method
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'longOffset'
        });
        
        const parts = formatter.formatToParts(now);
        const offsetString = parts.find(part => part.type === 'timeZoneName')?.value;
        
        if (offsetString && offsetString.startsWith('GMT')) {
          // Extract the offset part (e.g., "GMT+02:00" -> "+02:00")
          const offset = offsetString.replace('GMT', 'UTC');
          return offset === 'UTC' ? 'UTC+00:00' : offset;
        }
        
        // Fallback to manual calculation if needed
        const offsetMinutes = now.getTimezoneOffset() -
          new Date(now.toLocaleString('sv-SE', { timeZone: timezone })).getTimezoneOffset();
        
        // Format in ±HH:MM
        const hours = Math.floor(Math.abs(offsetMinutes) / 60);
        const minutes = Math.abs(offsetMinutes) % 60;
        const sign = offsetMinutes >= 0 ? '+' : '-';
        
        return `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      } catch {
        return '';
      }
    }

    /**
     * Find timezone or return best alternative
     */
    findTimezoneOrFallback(timezone) {
      if (!timezone) return 'UTC';
      
      // Check validity directly
      if (this.isValidTimezone(timezone)) {
        return timezone;
      }

      console.warn(`Timezone '${timezone}' not supported, searching for alternatives...`);

      // Search for alternatives from popular timezones only
      const regionMatches = this.popularTimezones.filter(tz => {
        const region = timezone.split('/')[0];
        return tz.startsWith(region + '/') && this.isValidTimezone(tz);
      });
      
      if (regionMatches.length > 0) {
        console.log(`Found region alternative: ${regionMatches[0]}`);
        return regionMatches[0];
      }

      // Search by city from popular timezones
      const city = timezone.split('/').pop();
      const cityMatch = this.popularTimezones.find(tz => 
        tz.includes(city) && this.isValidTimezone(tz)
      );
      
      if (cityMatch) {
        console.log(`Found city alternative: ${cityMatch}`);
        return cityMatch;
      }

      // Last fallback
      console.warn(`No alternative found for '${timezone}', using UTC`);
      return 'UTC';
    }

    /**
     * Create a list of timezones for UI (LIMITED TO POPULAR ONES FOR SLACK)
     */
    createTimezoneList() {
      if (this._timezoneListCache) {
        return this._timezoneListCache;
      }

      // ✅ ONLY use popular timezones to stay under Slack's 100 option limit
      const validTimezones = this.popularTimezones.filter(tz => this.isValidTimezone(tz));
      
      console.log(`📍 Using ${validTimezones.length} timezones for UI (TOP 10 only)`);
      
      this._timezoneListCache = validTimezones.map(tz => ({
        value: tz,
        label: this.getTimezoneLabel(tz)
      }));

      return this._timezoneListCache;
    }

    /**
     * Clear cache (for testing or updating)
     */
    clearCache() {
      this._timezoneListCache = null;
      this._allTimezonesCache = null;
    }
}

// Singleton instance
const timezoneHelper = new TimezoneHelper();

module.exports = timezoneHelper;