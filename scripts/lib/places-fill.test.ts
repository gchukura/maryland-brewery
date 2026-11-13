import { describe, expect, it } from 'vitest';
import {
  compareWithPlace,
  pickCandidate,
  sameBusiness,
  sameStreet,
  streetFromComponents,
} from './places-fill';

const stored = {
  name: 'Attaboy Barrel House',
  city: 'Frederick',
  latitude: 39.4117549,
  longitude: -77.403197,
  hours: { friday: '4:00 – 10:00 PM' },
  website: 'http://www.attaboybarrelhouse.com/',
  phone: '(301) 338-8229',
  street: '24 S Wisner St',
};

const components = [
  { short_name: '24', types: ['street_number'] },
  { short_name: 'S Wisner St', types: ['route'] },
  { short_name: 'Frederick', types: ['locality', 'political'] },
];

describe('streetFromComponents', () => {
  it('joins number and route', () => {
    expect(streetFromComponents(components)).toBe('24 S Wisner St');
  });
  it('is undefined without a route', () => {
    expect(streetFromComponents([components[0]])).toBeUndefined();
  });
});

describe('sameStreet', () => {
  it('ignores abbreviations, case and our suite', () => {
    expect(
      sameStreet('15201 Display Court, Suite 100', '15201 Display Ct')
    ).toBe(true);
    expect(sameStreet('24 South Wisner Street', '24 S Wisner St')).toBe(true);
  });
  it('ignores a quadrant Google adds', () => {
    expect(sameStreet('31706 Old Adams Road', '31706 Old Adams Rd NE')).toBe(
      true
    );
  });
  it('catches a different number', () => {
    expect(sameStreet('26 S Wisner St', '24 S Wisner St')).toBe(false);
  });
});

describe('sameBusiness', () => {
  it('matches on a distinctive word', () => {
    expect(sameBusiness('DuClaw Brewing Company', 'DuClaw Brewing Co.')).toBe(
      true
    );
    expect(sameBusiness("Frey's Brewing Company", 'Freys Brewing')).toBe(true);
  });
  it('rejects a different business', () => {
    expect(
      sameBusiness('DuClaw Brewing Company', 'Crooked Crab Brewing Company')
    ).toBe(false);
    expect(sameBusiness('Black Viking Brewing', 'Black Flag Brewing Co')).toBe(
      false
    );
  });
  it('accepts a longer Google name', () => {
    expect(sameBusiness('Beer Farm', 'Brookeville Beer Farm')).toBe(true);
  });
  it('ignores our city in the name', () => {
    expect(
      sameBusiness(
        'Evolution Craft Brewing Co - Salisbury',
        'Evolution Craft Brewing Co. & Public House',
        'Salisbury'
      )
    ).toBe(true);
  });
});

describe('pickCandidate', () => {
  const near = { location: { lat: 39.41, lng: -77.4 } };
  it('takes the first matching result nearby', () => {
    expect(
      pickCandidate(stored, [
        { place_id: 'a', name: 'Black Flag Brewing', geometry: near },
        { place_id: 'b', name: 'Attaboy Barrel House', geometry: near },
      ])?.place_id
    ).toBe('b');
  });
  it('prefers the nearest location', () => {
    expect(
      pickCandidate(stored, [
        {
          place_id: 'far',
          name: 'Attaboy Barrel House',
          geometry: { location: { lat: 39.6, lng: -77.4 } },
        },
        { place_id: 'near', name: 'Attaboy Barrel House', geometry: near },
      ])?.place_id
    ).toBe('near');
  });
  it('skips a match in another state', () => {
    expect(
      pickCandidate(stored, [
        {
          place_id: 'a',
          name: 'Attaboy Barrel House',
          geometry: { location: { lat: 39.17, lng: -120.14 } },
        },
      ])
    ).toBeUndefined();
  });
});

describe('compareWithPlace', () => {
  it('fills and compares nothing when the place is another business', () => {
    expect(
      compareWithPlace(
        { ...stored, website: null },
        { name: 'Black Flag Brewing Co', website: 'http://blackflag.example/' }
      )
    ).toEqual({
      fill: {},
      overwrite: {},
      differences: [],
      otherBusiness: 'Black Flag Brewing Co',
    });
  });

  it('treats the same name more than a mile away as another location', () => {
    expect(
      compareWithPlace(stored, {
        name: 'Attaboy Barrel House',
        geometry: { location: { lat: 39.5, lng: -77.403197 } },
      }).otherBusiness
    ).toBe('Attaboy Barrel House, 6.1 mi from our location');
  });

  it('accepts another name when the website matches', () => {
    expect(
      compareWithPlace(
        { ...stored, name: 'Maryland Beer Company, LLC' },
        { name: 'Elk River', website: 'https://attaboybarrelhouse.com' }
      ).otherBusiness
    ).toBeUndefined();
  });

  it('reports nothing when Google agrees', () => {
    expect(
      compareWithPlace(stored, {
        geometry: { location: { lat: 39.41176, lng: -77.4032 } },
        opening_hours: {
          weekday_text: ['Friday: 4:00 – 10:00 PM', 'Saturday: Closed'],
        },
        website: 'https://attaboybarrelhouse.com',
        formatted_phone_number: '(301) 338-8229',
        address_components: components,
      })
    ).toEqual({ fill: {}, overwrite: {}, differences: [] });
  });

  it('fills only blank fields', () => {
    const { fill, differences } = compareWithPlace(
      { ...stored, hours: {}, website: null, phone: '', street: '' },
      {
        opening_hours: {
          weekday_text: ['Friday: 4:00 – 10:00 PM', 'Monday: Closed'],
        },
        website: 'https://attaboy.example/',
        formatted_phone_number: '(301) 555-0100',
        address_components: components,
      }
    );
    expect(fill).toEqual({
      hours: { friday: '4:00 – 10:00 PM' },
      website: 'https://attaboy.example/',
      phone: '(301) 555-0100',
      street: '24 S Wisner St',
    });
    expect(differences).toEqual([]);
  });

  it("reports filled fields that differ with Google's values, and never fills them", () => {
    const { fill, overwrite, differences } = compareWithPlace(stored, {
      geometry: { location: { lat: 39.416, lng: -77.403197 } },
      opening_hours: { weekday_text: ['Friday: 3:00 – 10:00 PM'] },
      website: 'https://other.example/',
      formatted_phone_number: '(301) 555-0100',
      address_components: [
        { short_name: '10', types: ['street_number'] },
        { short_name: 'Market St', types: ['route'] },
      ],
    });
    expect(fill).toEqual({});
    expect(overwrite).toEqual({
      latitude: 39.416,
      longitude: -77.403197,
      hours: { friday: '3:00 – 10:00 PM' },
      website: 'https://other.example/',
      phone: '(301) 555-0100',
      street: '10 Market St',
    });
    expect(differences.map((d) => d.split(':')[0])).toEqual([
      'coordinates',
      'hours friday',
      'website',
      'phone',
      'street',
    ]);
  });
});
