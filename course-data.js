// Carz Inc Wholesale Car Buying Training Course
// Complete training curriculum for OVE and online wholesale platforms

const courseData = {
    modules: [
        {
            id: 'module-1',
            title: 'Introduction to Wholesale Car Buying',
            lessons: [
                {
                    id: 'lesson-1-1',
                    title: 'What is Wholesale Car Buying?',
                    content: `
                        <h2>What is Wholesale Car Buying?</h2>

                        <div class="lesson-section">
                            <h3>Retail vs. Wholesale</h3>
                            <p><strong>Retail</strong> is when you buy a car from a dealership at full price - what regular customers pay.</p>
                            <p><strong>Wholesale</strong> is when dealers buy cars from other dealers, auctions, or fleet companies at lower prices. This is how dealerships stock their inventory.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Why Wholesale?</h3>
                            <ul>
                                <li><strong>Lower prices:</strong> Typically 15-30% below retail</li>
                                <li><strong>Volume access:</strong> Thousands of vehicles available daily</li>
                                <li><strong>Variety:</strong> Every make, model, year, and condition</li>
                                <li><strong>Profit potential:</strong> Buy low, sell higher</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Where Do Wholesale Cars Come From?</h3>
                            <ul>
                                <li><strong>Trade-ins:</strong> Cars dealerships take in trade that don't fit their lot</li>
                                <li><strong>Lease returns:</strong> Vehicles coming off lease programs</li>
                                <li><strong>Fleet vehicles:</strong> Rental cars, company vehicles</li>
                                <li><strong>Repossessions:</strong> Bank repos and credit union vehicles</li>
                                <li><strong>Dealer overstock:</strong> Dealers selling excess inventory</li>
                            </ul>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Wholesale buying is how professional dealers acquire inventory. You're buying from the same sources they use.
                        </div>
                    `
                },
                {
                    id: 'lesson-1-2',
                    title: 'Types of Wholesale Platforms',
                    content: `
                        <h2>Types of Wholesale Platforms</h2>

                        <div class="lesson-section">
                            <h3>Physical Auctions (In-Lane)</h3>
                            <p>Traditional auction houses where cars drive through lanes and buyers bid in person.</p>
                            <ul>
                                <li>Manheim (largest - 100+ locations)</li>
                                <li>ADESA</li>
                                <li>America's Auto Auction</li>
                                <li>Independent regional auctions</li>
                            </ul>
                            <p><em>Pros:</em> Can inspect vehicles in person, see them run</p>
                            <p><em>Cons:</em> Must travel, fast-paced, limited time to decide</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Online Auctions - OVE (Our Focus)</h3>
                            <p><strong>OVE (Online Vehicle Exchange)</strong> is Manheim's online auction platform. This is where we'll be buying most of our inventory.</p>
                            <ul>
                                <li>24/7 access from anywhere</li>
                                <li>Timed auctions (usually 24-72 hours)</li>
                                <li>Detailed condition reports</li>
                                <li>Photos and sometimes videos</li>
                                <li>"Buy Now" and bidding options</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Other Online Platforms</h3>
                            <ul>
                                <li><strong>Manheim Express:</strong> Faster sales, often dealer direct</li>
                                <li><strong>ACV Auctions:</strong> Mobile-first platform</li>
                                <li><strong>BacklotCars:</strong> Dealer-to-dealer</li>
                                <li><strong>TradeRev:</strong> Quick dealer trades</li>
                            </ul>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> OVE gives you time to research, check condition reports, and make informed decisions - perfect for learning.
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-1',
                title: 'Module 1 Quiz',
                questions: [
                    {
                        question: 'What is the main difference between retail and wholesale car buying?',
                        options: [
                            'Wholesale cars are newer',
                            'Wholesale prices are typically 15-30% below retail',
                            'Retail cars have more miles',
                            'There is no difference'
                        ],
                        correct: 1,
                        explanation: 'Wholesale prices are lower because you\'re buying from dealer-to-dealer channels, not at consumer prices.'
                    },
                    {
                        question: 'What does OVE stand for?',
                        options: [
                            'Online Vehicle Estimation',
                            'Open Vehicle Exchange',
                            'Online Vehicle Exchange',
                            'Official Vehicle Evaluation'
                        ],
                        correct: 2,
                        explanation: 'OVE stands for Online Vehicle Exchange - Manheim\'s online auction platform.'
                    },
                    {
                        question: 'Which of these is NOT a common source of wholesale vehicles?',
                        options: [
                            'Trade-ins from dealerships',
                            'Lease returns',
                            'Private sellers on Craigslist',
                            'Fleet vehicles from rental companies'
                        ],
                        correct: 2,
                        explanation: 'Wholesale auctions deal with dealer trade-ins, lease returns, and fleet vehicles - not private party sales.'
                    },
                    {
                        question: 'What is an advantage of online auctions like OVE over physical auctions?',
                        options: [
                            'Cars are always cheaper',
                            'You have more time to research and decide',
                            'You can test drive the vehicles',
                            'There are no fees'
                        ],
                        correct: 1,
                        explanation: 'Online auctions give you 24-72 hours to research, check condition reports, and make informed decisions.'
                    }
                ]
            }
        },
        {
            id: 'module-2',
            title: 'Understanding the OVE Listing',
            lessons: [
                {
                    id: 'lesson-2-1',
                    title: 'Reading a Vehicle Listing',
                    content: `
                        <h2>Reading a Vehicle Listing</h2>

                        <div class="lesson-section">
                            <h3>Essential Information on Every Listing</h3>
                            <p>Every OVE listing contains critical information you need to evaluate:</p>

                            <div class="data-example">
                                <strong>Example Listing:</strong><br>
                                2018 GMC Sierra 1500 SLT<br>
                                VIN: 3GTU2NEC5JG328300<br>
                                Odometer: 95,264 miles<br>
                                Drivetrain: 4WD | Transmission: Automatic<br>
                                Engine: 8 Cylinder<br>
                                Interior: Black | Exterior: Black
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Breaking Down the Key Fields</h3>
                            <ul>
                                <li><strong>VIN (Vehicle Identification Number):</strong> 17-character unique ID. Use this to pull vehicle history reports (Carfax, AutoCheck)</li>
                                <li><strong>Year/Make/Model/Trim:</strong> Exactly what vehicle you're buying. Trim level matters for value!</li>
                                <li><strong>Odometer:</strong> Mileage - affects value significantly</li>
                                <li><strong>Drivetrain:</strong> 4WD/AWD/RWD/FWD - 4WD trucks command premium</li>
                                <li><strong>Engine:</strong> 4, 6, or 8 cylinder - affects capability and value</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Trim Levels Matter</h3>
                            <p>Using Chevrolet Silverado as example (low to high):</p>
                            <ol>
                                <li><strong>Work Truck (WT)</strong> - Basic, vinyl floors</li>
                                <li><strong>LT</strong> - Mid-level, more features</li>
                                <li><strong>LT Z71</strong> - Off-road package</li>
                                <li><strong>LTZ</strong> - Luxury features</li>
                                <li><strong>High Country</strong> - Top of the line</li>
                            </ol>
                            <p>A High Country can be worth $10,000+ more than an LT of same year/miles!</p>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Always verify the trim level matches the price. An LT priced like an LTZ is a red flag.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-2',
                    title: 'Understanding MMR (Manheim Market Report)',
                    content: `
                        <h2>Understanding MMR (Manheim Market Report)</h2>

                        <div class="lesson-section">
                            <h3>What is MMR?</h3>
                            <p><strong>MMR</strong> is the wholesale market value of a vehicle based on actual auction sales data. It's the most important number on any listing.</p>
                            <p>Think of MMR as the "blue book" for wholesale - it tells you what similar vehicles have actually sold for at auction.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>How to Use MMR</h3>

                            <div class="data-example">
                                <strong>Example:</strong><br>
                                2018 Chevy Silverado 1500 LTZ<br>
                                MMR: $26,100<br>
                                Current Bid: $26,000<br>
                                Buy Now: $27,000
                            </div>

                            <ul>
                                <li><strong>At or below MMR:</strong> Fair to good deal</li>
                                <li><strong>5-10% below MMR:</strong> Good deal</li>
                                <li><strong>10%+ below MMR:</strong> Great deal (but check WHY)</li>
                                <li><strong>Above MMR:</strong> You're overpaying</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>MMR Adjustments</h3>
                            <p>MMR is a baseline. Adjust for:</p>
                            <ul>
                                <li><strong>Condition:</strong> Below average condition = worth less than MMR</li>
                                <li><strong>Miles:</strong> Higher than average = worth less</li>
                                <li><strong>Options:</strong> Leather, sunroof, packages can add value</li>
                                <li><strong>Colors:</strong> White, black, silver sell faster</li>
                                <li><strong>Market timing:</strong> Trucks worth more in winter/spring</li>
                            </ul>
                        </div>

                        <div class="warning-box">
                            <strong>Warning:</strong> If a vehicle is priced way below MMR, there's usually a reason. Check the condition report and seller comments carefully!
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3',
                    title: 'Understanding CR Grades',
                    content: `
                        <h2>Understanding CR Grades</h2>

                        <div class="lesson-section">
                            <h3>The CR Grade Scale (1.0 - 5.0)</h3>
                            <p>Every vehicle on OVE gets a Condition Report (CR) grade from a certified inspector. The grade is calculated based on issues found during inspection.</p>

                            <div class="grade-scale">
                                <div class="grade grade-5">
                                    <strong>5.0 - Excellent</strong>
                                    <p>Like new, minimal wear, no issues - RARE and expensive</p>
                                </div>
                                <div class="grade grade-4">
                                    <strong>4.0-4.9 - Clean</strong>
                                    <p>Light wear, minor cosmetic only - premium pricing</p>
                                </div>
                                <div class="grade grade-3">
                                    <strong>3.0-3.9 - Average</strong>
                                    <p>Normal wear, some issues noted - common range</p>
                                </div>
                                <div class="grade grade-2">
                                    <strong>2.0-2.9 - Rough</strong>
                                    <p>Multiple issues, needs work - WHERE WE BUY</p>
                                </div>
                                <div class="grade grade-1">
                                    <strong>1.0-1.9 - Damaged</strong>
                                    <p>Major problems, significant repair needed - WHERE WE BUY</p>
                                </div>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Carz Inc Target: Grades 1.0 - 3.0</h3>
                            <p><strong>This is where we make money.</strong> Lower grade vehicles are priced lower at auction, giving us room for profit after rehab.</p>
                            <ul>
                                <li><strong>Grade 4.0+:</strong> Too expensive - tight margins, everyone wants these</li>
                                <li><strong>Grade 3.0-3.9:</strong> Can work if priced right</li>
                                <li><strong>Grade 2.0-2.9:</strong> Sweet spot - good discounts, fixable issues</li>
                                <li><strong>Grade 1.0-1.9:</strong> Best discounts - but evaluate rehab carefully</li>
                            </ul>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Low CR grade = low price = opportunity. The key is accurately estimating rehab costs to know if the deal works.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3a',
                    title: 'How CR Grade Affects MMR',
                    content: `
                        <h2>How CR Grade Affects MMR</h2>

                        <div class="lesson-section">
                            <h3>MMR Assumes Grade 4.0</h3>
                            <p><strong>This is critical to understand:</strong> When you look up MMR (Manheim Market Report), the "Adjusted MMR" value assumes the vehicle is in <strong>Grade 4.0 (Clean)</strong> condition.</p>

                            <div class="formula-box">
                                <strong>Adjusted MMR = Base MMR + Mileage Adjustment + Color + Grade 4.0 Assumed</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>The Disconnect Creates Opportunity</h3>
                            <p>When a vehicle has CR Grade 2.8 but MMR shows a value based on Grade 4.0, there's a gap:</p>

                            <div class="data-example">
                                <strong>Example - 2014 Ram 1500 Longhorn:</strong><br><br>

                                Adjusted MMR (assumes 4.0 grade): <strong>$21,400</strong><br>
                                Actual CR Grade: <strong>2.8 (Rough)</strong><br><br>

                                The MMR of $21,400 is what a CLEAN version would sell for.<br>
                                But this truck is ROUGH - so it sells for less at auction.<br><br>

                                <strong>Actual Purchase Price: $16,700</strong><br><br>

                                That's $4,700 below MMR because of the condition difference!
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Why This Matters for Carz Inc</h3>
                            <ul>
                                <li><strong>Book values assume clean condition</strong> - but we buy rough</li>
                                <li><strong>Auction prices reflect actual condition</strong> - rough sells cheaper</li>
                                <li><strong>The gap between "book" and "actual" is our profit opportunity</strong></li>
                                <li><strong>We fix it up</strong> - then sell at closer to book value</li>
                            </ul>

                            <div class="calculation-example">
                                <strong>The Math:</strong><br><br>
                                Buy rough truck: $16,700 (below MMR due to 2.8 grade)<br>
                                Fix it up: $2,500 rehab<br>
                                Total invested: $19,200<br><br>

                                Sell as clean: $21,000-22,000 (near book value)<br>
                                Spread: $1,800-2,800 profit potential
                            </div>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> MMR assumes Grade 4.0. When you buy Grade 1-3 vehicles, you're buying below book value. Fix the issues, and you can sell closer to book. That gap is your profit.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3a2',
                    title: 'Finding Issues Our Shop Handles Well',
                    content: `
                        <h2>Finding Issues Our Shop Handles Well</h2>

                        <div class="lesson-section">
                            <h3>Our Competitive Advantage</h3>
                            <p>We have a mechanic shop that can fix things cheaper and faster than retail. This means we can buy vehicles with specific issues that scare off other buyers - but that we can handle profitably.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Issues We WANT to See (Good for Us)</h3>
                            <p>These issues drop the CR grade and auction price, but our shop fixes them affordably:</p>

                            <table class="data-table">
                                <tr>
                                    <th>Issue Type</th>
                                    <th>Why Others Avoid</th>
                                    <th>Our Advantage</th>
                                </tr>
                                <tr>
                                    <td><strong>Hail damage</strong></td>
                                    <td>Looks terrible, scares buyers</td>
                                    <td>PDR is cheap, or sell as-is disclosed</td>
                                </tr>
                                <tr>
                                    <td><strong>Multiple dents/scratches</strong></td>
                                    <td>Cosmetic work seems expensive</td>
                                    <td>Body shop does volume pricing</td>
                                </tr>
                                <tr>
                                    <td><strong>Paint damage</strong></td>
                                    <td>Looks bad in photos</td>
                                    <td>Touch-up or respray panel cheap</td>
                                </tr>
                                <tr>
                                    <td><strong>Common mechanical codes</strong></td>
                                    <td>Check engine light scary</td>
                                    <td>Our mechanics know these fixes</td>
                                </tr>
                                <tr>
                                    <td><strong>Minor leaks</strong></td>
                                    <td>"Leaks" sounds bad</td>
                                    <td>Often just gasket/seal - cheap fix</td>
                                </tr>
                                <tr>
                                    <td><strong>Needs tires/brakes</strong></td>
                                    <td>Adds to buyer cost</td>
                                    <td>We get wholesale pricing</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Issues to Be Careful With</h3>
                            <p>Even with our shop, some issues are risky:</p>

                            <ul class="red-flags">
                                <li><strong>Transmission problems</strong> - Expensive even for us ($2,000-5,000)</li>
                                <li><strong>Engine knock/noise</strong> - Could need full engine</li>
                                <li><strong>Electrical issues (multiple)</strong> - Hard to diagnose, time consuming</li>
                                <li><strong>Frame damage</strong> - Structural, affects resale value</li>
                                <li><strong>Flood/fire history</strong> - Title issues, hidden problems</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>The Sweet Spot</h3>
                            <p>The ideal vehicle for Carz Inc:</p>
                            <ul class="green-flags">
                                <li>CR Grade 1.5 - 3.0</li>
                                <li>COSMETIC issues (dents, scratches, paint) - lots of them = big discount</li>
                                <li>Minor mechanical (known codes our shop handles)</li>
                                <li>Good interior (less work inside)</li>
                                <li>Starts and drives</li>
                                <li>No structural/frame damage</li>
                            </ul>

                            <div class="data-example">
                                <strong>Perfect Example:</strong><br><br>
                                "2019 Silverado LTZ - Grade 2.4"<br>
                                - 15 exterior issues (hail + dents)<br>
                                - 0 interior issues<br>
                                - 1 mechanical code (O2 sensor)<br>
                                - Starts/drives: Yes<br><br>

                                This looks terrible on paper but is mostly cosmetic.<br>
                                Big discount at auction, cheap to fix = PROFIT
                            </div>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> We're not avoiding problems - we're looking for the RIGHT problems. Issues our shop handles well at low cost create profit opportunities that others miss.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3a3',
                    title: 'Using Car-Part.com for Major Parts',
                    content: `
                        <h2>Using Car-Part.com for Major Parts</h2>

                        <div class="lesson-section">
                            <h3>What is Car-Part.com?</h3>
                            <p><strong>Car-Part.com</strong> is the largest used auto parts network in the world. It searches salvage yards and recyclers for parts.</p>
                            <p><strong>USE THIS ON EVERY VEHICLE</strong> when there are major mechanical issues to estimate repair costs.</p>

                            <div class="formula-box">
                                <strong>Before bidding on any vehicle with engine/trans/diff issues:<br>Look up parts cost on Car-Part.com</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>How to Use It</h3>
                            <ol>
                                <li>Go to <strong>car-part.com</strong></li>
                                <li>Enter your ZIP code</li>
                                <li>Select Year, Make, Model</li>
                                <li>Choose the part (Engine, Transmission, etc.)</li>
                                <li>Search - see prices from yards across the country</li>
                                <li>Note the range and average price</li>
                            </ol>
                        </div>

                        <div class="lesson-section">
                            <h3>What to Look Up</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Part</th>
                                    <th>When to Check</th>
                                    <th>Typical Range</th>
                                </tr>
                                <tr>
                                    <td><strong>Engine (complete)</strong></td>
                                    <td>Engine noise, knock, codes indicating internal damage</td>
                                    <td>$1,500-4,000+ depending on vehicle</td>
                                </tr>
                                <tr>
                                    <td><strong>Transmission</strong></td>
                                    <td>Trans codes, slipping, won't shift</td>
                                    <td>$800-2,500+</td>
                                </tr>
                                <tr>
                                    <td><strong>Differential</strong></td>
                                    <td>Diff noise, whining, 4WD issues</td>
                                    <td>$400-1,200</td>
                                </tr>
                                <tr>
                                    <td><strong>Transfer Case</strong></td>
                                    <td>4WD not engaging, grinding</td>
                                    <td>$500-1,500</td>
                                </tr>
                            </table>
                            <p><em>Add labor costs on top: typically $500-1,500 for major component swap</em></p>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Pricing an Engine Replacement</h3>
                            <div class="data-example">
                                <strong>Vehicle:</strong> 2017 Chevy Silverado 5.3L V8<br>
                                <strong>Issue:</strong> Engine knock, needs replacement<br><br>

                                <strong>Car-Part.com Search Results:</strong><br>
                                - Used 5.3L engine: $1,800 - $2,800<br>
                                - Average: ~$2,200<br><br>

                                <strong>Total Repair Estimate:</strong><br>
                                Engine: $2,200<br>
                                Labor: $1,200<br>
                                Misc (fluids, gaskets): $200<br>
                                <strong>TOTAL: ~$3,600</strong><br><br>

                                <em>If the vehicle isn't discounted by at least $4,000+, skip it.</em>
                            </div>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Car-Part.com tells you actual parts costs. Check it BEFORE bidding on anything with major mechanical issues. Part cost + labor = your rehab number.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3a4',
                    title: 'Carz Inc Rehab Cost Guide',
                    content: `
                        <h2>Carz Inc Rehab Cost Guide</h2>

                        <div class="lesson-section">
                            <h3>Major Mechanical (Use Car-Part.com + Labor)</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Repair</th>
                                    <th>Parts (Car-Part.com)</th>
                                    <th>Labor</th>
                                    <th>Total Estimate</th>
                                </tr>
                                <tr>
                                    <td><strong>Engine replacement</strong></td>
                                    <td>$1,500-4,000</td>
                                    <td>$1,000-1,500</td>
                                    <td>$2,500-5,500</td>
                                </tr>
                                <tr>
                                    <td><strong>Transmission replacement</strong></td>
                                    <td>$800-2,500</td>
                                    <td>$800-1,200</td>
                                    <td>$1,600-3,700</td>
                                </tr>
                                <tr>
                                    <td><strong>Differential replacement</strong></td>
                                    <td>$400-1,200</td>
                                    <td>$400-800</td>
                                    <td>$800-2,000</td>
                                </tr>
                                <tr>
                                    <td><strong>Transfer case</strong></td>
                                    <td>$500-1,500</td>
                                    <td>$500-800</td>
                                    <td>$1,000-2,300</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Warning Lights</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Light</th>
                                    <th>Common Causes</th>
                                    <th>Typical Cost</th>
                                </tr>
                                <tr>
                                    <td><strong>Check Engine Light</strong></td>
                                    <td>O2 sensor, catalytic converter, EVAP, misfire</td>
                                    <td>$100-2,000 (depends on code)</td>
                                </tr>
                                <tr>
                                    <td><strong>Airbag Light</strong></td>
                                    <td>Sensor, clockspring, module</td>
                                    <td>$200-800</td>
                                </tr>
                                <tr>
                                    <td><strong>Traction Control Light</strong></td>
                                    <td>Wheel speed sensor, ABS module</td>
                                    <td>$150-600</td>
                                </tr>
                                <tr>
                                    <td><strong>ABS Light</strong></td>
                                    <td>Wheel speed sensor, ABS pump</td>
                                    <td>$200-1,200</td>
                                </tr>
                                <tr>
                                    <td><strong>TPMS Light</strong></td>
                                    <td>Sensors need replacement</td>
                                    <td>$50-80 per sensor</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Body Work</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Work Type</th>
                                    <th>Cost</th>
                                    <th>Notes</th>
                                </tr>
                                <tr>
                                    <td><strong>Body panel repair/paint</strong></td>
                                    <td>$300-400 per panel</td>
                                    <td>Dents, scratches, paint damage</td>
                                </tr>
                                <tr>
                                    <td><strong>Hail damage (per panel)</strong></td>
                                    <td>$400-500 per panel</td>
                                    <td>Can get much worse - see below</td>
                                </tr>
                                <tr>
                                    <td><strong>PDR (paintless dent repair)</strong></td>
                                    <td>$75-150 per dent</td>
                                    <td>Small dents without paint damage</td>
                                </tr>
                                <tr>
                                    <td><strong>Bumper repair</strong></td>
                                    <td>$200-400</td>
                                    <td>Scuffs, cracks, minor damage</td>
                                </tr>
                                <tr>
                                    <td><strong>Bumper replacement</strong></td>
                                    <td>$400-800</td>
                                    <td>Includes paint match</td>
                                </tr>
                            </table>
                        </div>

                        <div class="warning-box">
                            <strong>HAIL DAMAGE WARNING:</strong><br><br>
                            Look at the photos carefully - check reflections on panels. <strong>If you can see hail damage in the pictures, it's probably MUCH WORSE in person.</strong><br><br>
                            Photos hide a lot. Lighting at auction is designed to make cars look good. If hail is visible in pics, multiply your estimate.
                        </div>

                        <div class="lesson-section">
                            <h3>Interior Work</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Work Type</th>
                                    <th>Cost</th>
                                </tr>
                                <tr>
                                    <td><strong>Full detail (interior + exterior)</strong></td>
                                    <td>$200-400</td>
                                </tr>
                                <tr>
                                    <td><strong>Seat reupholster or replace</strong></td>
                                    <td>$300 per seat</td>
                                </tr>
                                <tr>
                                    <td><strong>Carpet replacement</strong></td>
                                    <td>$300-500</td>
                                </tr>
                                <tr>
                                    <td><strong>Headliner repair</strong></td>
                                    <td>$200-400</td>
                                </tr>
                                <tr>
                                    <td><strong>Odor removal (ozone)</strong></td>
                                    <td>$200-400</td>
                                </tr>
                                <tr>
                                    <td><strong>Steering wheel wrap/repair</strong></td>
                                    <td>$100-200</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Other Common Repairs</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Repair</th>
                                    <th>Cost</th>
                                </tr>
                                <tr>
                                    <td><strong>Tires (set of 4)</strong></td>
                                    <td>$600-1,200</td>
                                </tr>
                                <tr>
                                    <td><strong>Brakes (pads + rotors, all 4)</strong></td>
                                    <td>$400-800</td>
                                </tr>
                                <tr>
                                    <td><strong>Windshield replacement</strong></td>
                                    <td>$200-500</td>
                                </tr>
                                <tr>
                                    <td><strong>Key fob programming</strong></td>
                                    <td>$200-400</td>
                                </tr>
                                <tr>
                                    <td><strong>AC repair (common)</strong></td>
                                    <td>$300-800</td>
                                </tr>
                                <tr>
                                    <td><strong>AC compressor replacement</strong></td>
                                    <td>$600-1,200</td>
                                </tr>
                            </table>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Know these costs by heart. When you see issues on a CR, you should be able to quickly estimate rehab. Body work = $300-400/panel. Seats = $300. Hail = $400-500/panel minimum. Major mechanical = check Car-Part.com.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3b',
                    title: 'What Affects CR Grade - Exterior',
                    content: `
                        <h2>What Affects CR Grade - Exterior</h2>

                        <div class="lesson-section">
                            <h3>Exterior Issues Drop the Grade</h3>
                            <p>Exterior condition is the biggest factor in CR grade. Each issue deducts points.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Dents & Dings</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Issue</th>
                                    <th>Grade Impact</th>
                                    <th>Typical Fix Cost</th>
                                </tr>
                                <tr>
                                    <td>Small ding (door ding)</td>
                                    <td>Minor</td>
                                    <td>$75-100 PDR</td>
                                </tr>
                                <tr>
                                    <td>Small dent</td>
                                    <td>Minor-Moderate</td>
                                    <td>$100-150 PDR</td>
                                </tr>
                                <tr>
                                    <td>Multiple dents</td>
                                    <td>Moderate</td>
                                    <td>$150-400 PDR</td>
                                </tr>
                                <tr>
                                    <td>Large dent</td>
                                    <td>Significant</td>
                                    <td>$200-500 body work</td>
                                </tr>
                                <tr>
                                    <td>Hail damage (multiple panels)</td>
                                    <td>Major</td>
                                    <td>$1,000-3,000+</td>
                                </tr>
                            </table>
                            <p><em>PDR = Paintless Dent Repair - cheaper than body shop</em></p>
                        </div>

                        <div class="lesson-section">
                            <h3>Paint & Scratches</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Issue</th>
                                    <th>Grade Impact</th>
                                    <th>Typical Fix Cost</th>
                                </tr>
                                <tr>
                                    <td>Light scratch</td>
                                    <td>Minor</td>
                                    <td>$50-100 buff/touch-up</td>
                                </tr>
                                <tr>
                                    <td>Multiple scratches</td>
                                    <td>Minor-Moderate</td>
                                    <td>$100-300</td>
                                </tr>
                                <tr>
                                    <td>Deep scratch (through clear coat)</td>
                                    <td>Moderate</td>
                                    <td>$150-400</td>
                                </tr>
                                <tr>
                                    <td>Paint damage/peeling</td>
                                    <td>Significant</td>
                                    <td>$300-800 per panel</td>
                                </tr>
                                <tr>
                                    <td>Rust</td>
                                    <td>Major</td>
                                    <td>$500-2,000+</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Glass & Lights</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Issue</th>
                                    <th>Grade Impact</th>
                                    <th>Typical Fix Cost</th>
                                </tr>
                                <tr>
                                    <td>Windshield chip</td>
                                    <td>Minor</td>
                                    <td>$50-100 repair</td>
                                </tr>
                                <tr>
                                    <td>Windshield crack/pitted</td>
                                    <td>Moderate</td>
                                    <td>$200-400 replacement</td>
                                </tr>
                                <tr>
                                    <td>Broken mirror</td>
                                    <td>Minor-Moderate</td>
                                    <td>$100-300</td>
                                </tr>
                                <tr>
                                    <td>Headlight/taillight damage</td>
                                    <td>Moderate</td>
                                    <td>$150-500 each</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Bumpers & Body Panels</h3>
                            <ul>
                                <li><strong>Bumper scuffs:</strong> Minor impact - $100-200 to repair</li>
                                <li><strong>Bumper crack/damage:</strong> Moderate - $200-600 repair or $300-800 replace</li>
                                <li><strong>Aftermarket bumper:</strong> Usually noted, may be plus or minus</li>
                                <li><strong>Fender damage:</strong> Moderate-Significant - $300-1,000</li>
                                <li><strong>Hood damage:</strong> Significant - $400-1,200</li>
                                <li><strong>Bed damage (trucks):</strong> Varies - $200-1,500</li>
                            </ul>
                        </div>

                        <div class="key-point">
                            <strong>Pro Tip:</strong> Cosmetic damage looks scary but is often cheap to fix. Hail damage trucks can be goldmines if the discount is big enough.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3c',
                    title: 'What Affects CR Grade - Interior & Mechanical',
                    content: `
                        <h2>What Affects CR Grade - Interior & Mechanical</h2>

                        <div class="lesson-section">
                            <h3>Interior Condition</h3>
                            <p>Interior issues are noted but often have less grade impact than exterior - unless severe.</p>

                            <table class="data-table">
                                <tr>
                                    <th>Issue</th>
                                    <th>Grade Impact</th>
                                    <th>Typical Fix Cost</th>
                                </tr>
                                <tr>
                                    <td>Wear on seats/steering wheel</td>
                                    <td>Minor</td>
                                    <td>Detail or leave as-is</td>
                                </tr>
                                <tr>
                                    <td>Stains</td>
                                    <td>Minor</td>
                                    <td>$100-300 detail</td>
                                </tr>
                                <tr>
                                    <td>Tears/rips in seats</td>
                                    <td>Moderate</td>
                                    <td>$150-400 repair</td>
                                </tr>
                                <tr>
                                    <td>Headliner sagging</td>
                                    <td>Moderate</td>
                                    <td>$200-400</td>
                                </tr>
                                <tr>
                                    <td>Odor (smoke/pet)</td>
                                    <td>Moderate-Significant</td>
                                    <td>$200-500 ozone treatment</td>
                                </tr>
                                <tr>
                                    <td>Dashboard damage</td>
                                    <td>Moderate</td>
                                    <td>$100-300 cover or repair</td>
                                </tr>
                                <tr>
                                    <td>Missing parts/broken controls</td>
                                    <td>Varies</td>
                                    <td>$50-500 depending on part</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Mechanical & Diagnostic Codes</h3>
                            <p><strong>This is where you need to be careful.</strong> Mechanical issues can be cheap or VERY expensive.</p>

                            <table class="data-table">
                                <tr>
                                    <th>Issue</th>
                                    <th>Grade Impact</th>
                                    <th>Cost Range</th>
                                </tr>
                                <tr>
                                    <td>Check engine light - minor code</td>
                                    <td>Moderate</td>
                                    <td>$100-500</td>
                                </tr>
                                <tr>
                                    <td>Check engine light - major code</td>
                                    <td>Significant</td>
                                    <td>$500-3,000+</td>
                                </tr>
                                <tr>
                                    <td>Active leaks (minor)</td>
                                    <td>Moderate</td>
                                    <td>$200-600</td>
                                </tr>
                                <tr>
                                    <td>Active leaks (major)</td>
                                    <td>Significant</td>
                                    <td>$500-2,000+</td>
                                </tr>
                                <tr>
                                    <td>Engine noise</td>
                                    <td>Major</td>
                                    <td>$500-5,000+ (could be engine)</td>
                                </tr>
                                <tr>
                                    <td>Transmission issues</td>
                                    <td>Major</td>
                                    <td>$2,000-5,000+</td>
                                </tr>
                                <tr>
                                    <td>AC not working</td>
                                    <td>Moderate</td>
                                    <td>$200-1,200</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Tires & Wheels</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Issue</th>
                                    <th>Grade Impact</th>
                                    <th>Typical Fix Cost</th>
                                </tr>
                                <tr>
                                    <td>Tire depth below 4/32"</td>
                                    <td>Noted</td>
                                    <td>$150-300 per tire</td>
                                </tr>
                                <tr>
                                    <td>Mismatched tires</td>
                                    <td>Minor</td>
                                    <td>Replace as needed</td>
                                </tr>
                                <tr>
                                    <td>Wheel cosmetic damage (curb rash)</td>
                                    <td>Minor</td>
                                    <td>$75-150 per wheel to refinish</td>
                                </tr>
                                <tr>
                                    <td>Wheel structural damage</td>
                                    <td>Moderate</td>
                                    <td>$200-600 replacement</td>
                                </tr>
                            </table>
                        </div>

                        <div class="warning-box">
                            <strong>Be Careful With:</strong>
                            <ul>
                                <li><strong>Transmission codes/issues</strong> - Can kill a deal fast</li>
                                <li><strong>Engine noise/knocking</strong> - Could need full engine</li>
                                <li><strong>Electrical gremlins</strong> - Hard to diagnose, expensive</li>
                            </ul>
                            These can turn a "deal" into a loss. Factor high rehab or skip.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3d',
                    title: 'Reading the Full Condition Report',
                    content: `
                        <h2>Reading the Full Condition Report</h2>

                        <div class="lesson-section">
                            <h3>CR Report Sections</h3>
                            <p>Every OVE condition report has these sections:</p>
                            <ol>
                                <li><strong>Overview</strong> - Grade, structural damage yes/no, drivable yes/no</li>
                                <li><strong>Announcements</strong> - Recalls, seller remarks</li>
                                <li><strong>Drivability, Keys & History</strong> - Starts? Drives? How many keys?</li>
                                <li><strong>Exterior</strong> - Panel by panel breakdown</li>
                                <li><strong>Interior</strong> - Seats, dash, electronics</li>
                                <li><strong>Mechanical & Codes</strong> - Diagnostic trouble codes listed</li>
                                <li><strong>Tires & Wheels</strong> - Tread depth, wheel condition</li>
                            </ol>
                        </div>

                        <div class="lesson-section">
                            <h3>Issue Count Summary</h3>
                            <p>OVE shows issue counts by category:</p>
                            <div class="data-example">
                                <strong>Example from Ram 1500:</strong><br><br>
                                DRIVABILITY, KEYS, & HISTORY: 0<br>
                                EXTERIOR: 13 <span style="color: #e94560;">← Lots of cosmetic work</span><br>
                                INTERIOR: 0 <span style="color: #4ade80;">← Clean inside</span><br>
                                MECHANICAL & DIAGNOSTIC CODES: 2 <span style="color: #facc15;">← Check what codes</span><br>
                                TIRES & WHEELS: 3
                            </div>
                            <p>High exterior count with low mechanical = cosmetic project (often good).<br>
                            Low exterior with high mechanical = potential money pit (be careful).</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Key Things to Check</h3>
                            <ul>
                                <li><strong>STRUCTURAL DAMAGE:</strong> Should say "No" - if "Yes", usually skip</li>
                                <li><strong>DRIVABLE:</strong> Should say "Yes - Drives" - non-runners are risky</li>
                                <li><strong>STARTS:</strong> Should say "Yes - Starts"</li>
                                <li><strong>KEYS:</strong> 2+ smart keys is good, 0-1 may need $200-400 for extra key</li>
                                <li><strong>ODOR:</strong> "Smoke" or "Pet" = budget for ozone treatment</li>
                                <li><strong>FRAME:</strong> Any frame mention = walk away</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Putting It Together</h3>
                            <div class="calculation-example">
                                <strong>Example Evaluation:</strong><br><br>
                                CR Grade: 2.8<br>
                                Exterior Issues: 13<br>
                                Mechanical Codes: 2 (coolant bypass valve)<br>
                                Interior: Clean<br>
                                Tires: Good (6/32"+)<br><br>

                                <strong>Analysis:</strong><br>
                                - Cosmetic heavy (13 exterior) = $800-1,500 body/paint<br>
                                - Mechanical codes are specific (not vague) = $400-600<br>
                                - Interior clean = $0<br>
                                - Tires good = $0<br><br>

                                <strong>Total Rehab Estimate: $1,200-2,100</strong>
                            </div>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Read EVERY line of the CR. The issue count tells you where to focus. Cosmetic issues are usually fixable - mechanical issues need careful evaluation.
                        </div>
                    `
                },
                {
                    id: 'lesson-2-3e',
                    title: 'CRITICAL: 4WD vs 2WD - It\'s About DEMAND',
                    content: `
                        <h2>CRITICAL: 4WD vs 2WD - It's About DEMAND</h2>

                        <div class="highlight-box" style="background: #1a3a1a; border: 2px solid #4ade80; padding: 25px;">
                            <h3 style="color: #4ade80;">KEY INSIGHT: We Target DEMAND - That's Our #1 Priority</h3>
                            <p style="font-size: 1.2em;">Book values already adjust for 2WD vs 4WD. The real difference is how fast it sells.</p>
                            <ul style="margin-top: 15px;">
                                <li><strong style="color: #4ade80;">4WD = HIGH DEMAND</strong> → Sells fast (25-35 days) → Can stretch on price</li>
                                <li><strong style="color: #e94560;">2WD = LOW DEMAND</strong> → Cold inventory (60-90 days) → Don't overpay</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Where to Find Drivetrain</h3>
                            <p>ALWAYS check the drivetrain field on every truck listing:</p>
                            <ul>
                                <li><strong style="color: #4ade80;">4WD / 4x4:</strong> Four-wheel drive - HIGH DEMAND - WHAT WE WANT</li>
                                <li><strong>AWD:</strong> All-wheel drive - Good for SUVs</li>
                                <li><strong style="color: #e94560;">RWD / 2WD:</strong> Rear-wheel/Two-wheel drive - LOW DEMAND</li>
                                <li><strong>FWD:</strong> Front-wheel drive - OK for cars/small SUVs</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Why DEMAND Matters More Than Price</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Factor</th>
                                    <th>4WD (High Demand)</th>
                                    <th>2WD (Low Demand)</th>
                                </tr>
                                <tr>
                                    <td>Days on lot</td>
                                    <td style="color: #4ade80;">25-35 days</td>
                                    <td style="color: #e94560;">60-90 days</td>
                                </tr>
                                <tr>
                                    <td>Floor plan cost</td>
                                    <td style="color: #4ade80;">~$100-150</td>
                                    <td style="color: #e94560;">$300-500+</td>
                                </tr>
                                <tr>
                                    <td>Buyer pool</td>
                                    <td style="color: #4ade80;">Everyone wants it</td>
                                    <td style="color: #e94560;">Warm climate only</td>
                                </tr>
                                <tr>
                                    <td>Can you stretch?</td>
                                    <td style="color: #4ade80;">YES - sells quick, less risk</td>
                                    <td style="color: #e94560;">NO - ties up capital</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>The Real Cost of Slow Inventory</h3>
                            <div class="calculation-example">
                                <strong>2WD sitting 90 days vs 4WD selling in 30 days:</strong><br><br>
                                Extra 60 days on floor plan = <strong>$400+ in fees</strong><br>
                                Capital tied up = Can't buy other deals<br>
                                Price drops while sitting = Less profit<br><br>
                                <span style="color: #e94560;">A 2WD that looks profitable can turn into a loss just from sitting.</span>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Book Value Already Adjusts</h3>
                            <div class="info-box">
                                <p><strong>Good news:</strong> Black Book and other guides already adjust values for 2WD vs 4WD.</p>
                                <p>When you pull Autoniq for a 2WD truck, the value shown IS the 2WD value.</p>
                                <p><strong>You don't need to deduct extra dollars.</strong> Just understand it's cold inventory with low demand.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>The Rule: High Demand = Can Stretch, Low Demand = Stick to Number</h3>
                            <div class="highlight-box" style="border-color: #4ade80;">
                                <h4 style="color: #4ade80;">4WD Crew Cab (High Demand):</h4>
                                <p>If the numbers are close, you can stretch a bit. It will sell fast, minimizing floor plan and risk.</p>
                            </div>
                            <div class="warning-box" style="border-color: #e94560;">
                                <h4 style="color: #e94560;">2WD / Extended Cab (Low Demand):</h4>
                                <p>Stick to your max bid. Don't stretch. If it's not a great deal, pass. It will sit and eat your profit.</p>
                            </div>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">BOTTOM LINE:</h3>
                            <p style="font-size: 1.2em;">We target demand. 4WD sells fast = less risk. 2WD is cold = don't overpay. Book value is what it is - the question is how fast will it move?</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-2-4',
                    title: 'Seller Comments & Red Flags',
                    content: `
                        <h2>Seller Comments & Red Flags</h2>

                        <div class="lesson-section">
                            <h3>Reading Seller Comments</h3>
                            <p>The seller comments section contains critical disclosures. <strong>ALWAYS READ THIS!</strong></p>

                            <div class="data-example">
                                <strong>Real Examples from Listings:</strong><br><br>
                                "HAIL DAMAGE DENTS AND SCRATCHES" - Body damage<br><br>
                                "HAIL DAMAGE, FEW DINGS AND SCRATCHES, WINDSHIELD CHIPPED, ENGINE LIGHT ON, MIRRORS CRACKED" - Multiple issues<br><br>
                                "LIMITED GUAR. NO ARB ON LEAKS" - Limited guarantee, no arbitration for leaks<br><br>
                                "engine" (in notes) - Engine issues noted
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Major Red Flags - AVOID as a Beginner</h3>
                            <ul class="red-flags">
                                <li><strong>"Engine light on"</strong> - Could be minor or major issue</li>
                                <li><strong>"Transmission issues"</strong> - Expensive repairs</li>
                                <li><strong>"Frame damage"</strong> - Structural, hard to sell</li>
                                <li><strong>"Flood"</strong> - Never buy flood vehicles</li>
                                <li><strong>"Fire damage"</strong> - Avoid completely</li>
                                <li><strong>"No arbitration"</strong> - Seller won't take it back if issues found</li>
                                <li><strong>"As-is"</strong> - No recourse</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Acceptable Issues (with price adjustment)</h3>
                            <ul class="green-flags">
                                <li><strong>Hail damage</strong> - Cosmetic, can be fixed or sold as-is with disclosure</li>
                                <li><strong>Dings and scratches</strong> - Normal wear, expected</li>
                                <li><strong>Needs tires</strong> - Easy fix, negotiate into price</li>
                                <li><strong>Needs brakes</strong> - Common, budget for it</li>
                                <li><strong>Minor dents</strong> - PDR can fix cheap</li>
                            </ul>
                        </div>

                        <div class="warning-box">
                            <strong>Golden Rule:</strong> If the seller is disclosing issues, there are probably more issues they're NOT disclosing. Always budget extra for surprises.
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-2',
                title: 'Module 2 Quiz',
                questions: [
                    {
                        question: 'What does MMR stand for?',
                        options: [
                            'Maximum Market Rate',
                            'Manheim Market Report',
                            'Minimum Market Range',
                            'Motor Market Rating'
                        ],
                        correct: 1,
                        explanation: 'MMR stands for Manheim Market Report - the wholesale market value based on actual auction sales.'
                    },
                    {
                        question: 'A vehicle has an MMR of $25,000 and is listed at $22,000. What does this indicate?',
                        options: [
                            'The vehicle is overpriced',
                            'This is a fair market deal',
                            'This could be a good deal - but check WHY it\'s priced low',
                            'The MMR is wrong'
                        ],
                        correct: 2,
                        explanation: 'When a vehicle is priced significantly below MMR, it could be a great deal OR there could be issues. Always check the condition report and seller comments.'
                    },
                    {
                        question: 'What CR grade range does Carz Inc target?',
                        options: [
                            '4.0 and above',
                            '1.0 - 3.0',
                            '3.5 and above',
                            '5.0 only'
                        ],
                        correct: 1,
                        explanation: 'Carz Inc targets grades 1.0-3.0. Lower grades mean bigger discounts at auction, and our shop can fix the issues profitably.'
                    },
                    {
                        question: 'You see a listing with "ENGINE LIGHT ON" in seller comments. What should you do?',
                        options: [
                            'Buy it - engine lights are always minor',
                            'Check what codes are listed and estimate repair cost',
                            'Ignore the comment and bid anyway',
                            'Engine lights mean the vehicle is totaled'
                        ],
                        correct: 1,
                        explanation: 'Check the diagnostic codes in the CR. Some codes are cheap fixes our shop handles well, others are expensive. Evaluate based on the specific codes.'
                    },
                    {
                        question: 'Which Silverado trim is the highest/most expensive?',
                        options: [
                            'LT',
                            'Work Truck',
                            'LTZ',
                            'High Country'
                        ],
                        correct: 3,
                        explanation: 'High Country is Chevrolet\'s top trim level. The hierarchy is: Work Truck < LT < LT Z71 < LTZ < High Country.'
                    },
                    {
                        question: 'A 2019 GMC Sierra has a CR Grade of 2.6. What does this mean?',
                        options: [
                            'Excellent condition, ready for retail',
                            'Average condition with normal wear',
                            'Rough condition with significant issues',
                            'The vehicle hasn\'t been inspected'
                        ],
                        correct: 2,
                        explanation: 'A grade of 2.6 falls in the "Rough" category (2.0-2.9), indicating significant wear or issues. Not ideal for retail resale.'
                    },
                    {
                        question: 'How much does body panel repair/paint typically cost per panel?',
                        options: [
                            '$100-150',
                            '$300-400',
                            '$600-800',
                            '$1,000+'
                        ],
                        correct: 1,
                        explanation: 'Body panel repair and paint costs $300-400 per panel. This covers dents, scratches, and paint damage. Know this number by heart!'
                    },
                    {
                        question: 'A truck needs new tires (set of 4). What should you budget?',
                        options: [
                            '$200-400',
                            '$400-500',
                            '$600-1,200',
                            '$1,500-2,000'
                        ],
                        correct: 2,
                        explanation: 'A set of 4 tires typically costs $600-1,200 depending on size and quality. Trucks often need larger, more expensive tires.'
                    },
                    {
                        question: 'The CR says "Brakes need service - pads and rotors worn". What should you estimate for all 4 wheels?',
                        options: [
                            '$100-200',
                            '$400-800',
                            '$1,200-1,500',
                            '$2,000+'
                        ],
                        correct: 1,
                        explanation: 'Brakes (pads + rotors, all 4 wheels) typically cost $400-800. This is a common recon item.'
                    },
                    {
                        question: 'A seat is torn and needs replacement. How much per seat?',
                        options: [
                            '$100',
                            '$300',
                            '$500',
                            '$800'
                        ],
                        correct: 1,
                        explanation: 'Seat reupholster or replacement costs about $300 per seat. If multiple seats need work, multiply accordingly.'
                    },
                    {
                        question: 'You see hail damage on a truck. How much should you estimate PER PANEL for hail repair?',
                        options: [
                            '$100-200',
                            '$400-500',
                            '$50-75',
                            '$800-1,000'
                        ],
                        correct: 1,
                        explanation: 'Hail damage costs $400-500 per panel minimum. WARNING: If you can see hail in photos, it\'s probably MUCH WORSE in person. Photos hide a lot!'
                    },
                    {
                        question: 'The interior is dirty with pet hair and stains. What does a full detail (interior + exterior) cost?',
                        options: [
                            '$50-100',
                            '$200-400',
                            '$600-800',
                            '$1,000+'
                        ],
                        correct: 1,
                        explanation: 'A full detail (interior + exterior) costs $200-400. For heavy smoke or pet odor, add ozone treatment ($200-400 extra).'
                    },
                    {
                        question: 'The windshield has a crack. How much for replacement?',
                        options: [
                            '$50-100',
                            '$200-500',
                            '$800-1,200',
                            '$1,500+'
                        ],
                        correct: 1,
                        explanation: 'Windshield replacement typically costs $200-500 depending on the vehicle. Some trucks with rain sensors or HUDs cost more.'
                    }
                ]
            }
        },
        {
            id: 'module-3',
            title: 'Understanding Book Values',
            lessons: [
                {
                    id: 'lesson-3-1',
                    title: 'What Are Book Values?',
                    content: `
                        <h2>What Are Book Values?</h2>

                        <div class="highlight-box" style="background: #1a3a1a; border: 2px solid #4ade80; padding: 25px;">
                            <h3 style="color: #4ade80;">Book Values = What the Market Will Pay</h3>
                            <p style="font-size: 1.1em;">Book values tell you what a vehicle is actually worth in the wholesale market. This is the foundation of every deal you'll ever do.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Why Book Values Matter</h3>
                            <ul>
                                <li><strong>They determine your max bid</strong> - You can't pay more than the market will give back</li>
                                <li><strong>They're based on real sales</strong> - Not opinions, actual transaction data</li>
                                <li><strong>They account for condition</strong> - Different values for different conditions</li>
                                <li><strong>They're updated constantly</strong> - Reflect current market, not last month</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>The Book Value Sources We Use</h3>
                            <p>We use <strong>Autoniq</strong> which pulls from multiple sources:</p>
                            <table class="data-table">
                                <tr>
                                    <th>Priority</th>
                                    <th>Source</th>
                                    <th>What It Is</th>
                                </tr>
                                <tr style="background: rgba(74, 222, 128, 0.2);">
                                    <td style="color: #4ade80;"><strong>#1</strong></td>
                                    <td><strong>MMR</strong></td>
                                    <td>Manheim Market Report - actual auction sales</td>
                                </tr>
                                <tr>
                                    <td><strong>#2</strong></td>
                                    <td><strong>J.D. Power</strong></td>
                                    <td>Trade-in values - retail focused</td>
                                </tr>
                                <tr>
                                    <td><strong>#3</strong></td>
                                    <td><strong>Black Book</strong></td>
                                    <td>Wholesale auction values</td>
                                </tr>
                            </table>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">REMEMBER:</h3>
                            <p style="font-size: 1.2em;">Book value is REALITY. It's not what you hope to get - it's what the market will actually pay. Never bid based on hopes, bid based on book.</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-3-2',
                    title: 'Black Book Explained',
                    content: `
                        <h2>Black Book Explained</h2>

                        <div class="lesson-section">
                            <h3>What is Black Book?</h3>
                            <p>Black Book provides wholesale values - what dealers pay at auction. It's our <strong>third source</strong> (after MMR and J.D. Power) and helps see which way the scale tips when calculating Target Sales Price.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>The Four Condition Grades</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Grade</th>
                                    <th>Condition</th>
                                    <th>What It Means</th>
                                </tr>
                                <tr>
                                    <td style="color: #4ade80;"><strong>XClean</strong></td>
                                    <td>Extra Clean</td>
                                    <td>Near perfect, minimal wear, ready for retail lot</td>
                                </tr>
                                <tr>
                                    <td style="color: #4ade80;"><strong>Clean</strong></td>
                                    <td>Clean</td>
                                    <td>Good condition, minor wear, light recon needed</td>
                                </tr>
                                <tr>
                                    <td style="color: #facc15;"><strong>Avg</strong></td>
                                    <td>Average</td>
                                    <td>Normal wear for age/miles, moderate recon needed</td>
                                </tr>
                                <tr>
                                    <td style="color: #e94560;"><strong>Rough</strong></td>
                                    <td>Rough</td>
                                    <td>Significant wear/issues, needs real work</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Black Book Values</h3>
                            <div class="data-example">
                                <strong>2019 Ram 1500 Rebel Crew Cab 4x4 | 45,000 miles</strong><br><br>
                                <table style="width: 100%;">
                                    <tr>
                                        <td>XClean:</td>
                                        <td><strong>$32,500</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Clean:</td>
                                        <td><strong>$30,200</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Avg:</td>
                                        <td><strong>$27,800</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Rough:</td>
                                        <td><strong>$24,500</strong></td>
                                    </tr>
                                </table>
                                <p style="margin-top: 15px;">Spread from XClean to Rough: <strong>$8,000</strong></p>
                            </div>
                        </div>

                        <div class="warning-box">
                            <h3 style="color: #e94560;">IMPORTANT: History Adjusted Values</h3>
                            <p>Black Book provides <strong>"History Adjusted"</strong> values that already account for:</p>
                            <ul>
                                <li>Number of accidents</li>
                                <li>Number of previous owners</li>
                                <li>Title issues</li>
                            </ul>
                            <p style="margin-top: 10px;"><strong>ALWAYS use the History Adjusted value when available!</strong> It's already done the math for you.</p>
                        </div>

                        <div class="key-point">
                            <h3>Which Black Book Value Do We Use?</h3>
                            <p>Match the CR grade to the condition:</p>
                            <ul>
                                <li>CR 4.0+ → Use <strong>Clean</strong> or <strong>XClean</strong></li>
                                <li>CR 3.0-3.9 → Use <strong>Avg</strong> or <strong>Clean</strong></li>
                                <li>CR 2.0-2.9 → Use <strong>Avg</strong></li>
                                <li>CR Below 2.0 → Use <strong>Rough</strong></li>
                            </ul>
                        </div>
                    `
                },
                {
                    id: 'lesson-3-2b',
                    title: 'Why Different Book Values Exist',
                    content: `
                        <h2>Why Different Book Values Exist</h2>

                        <div class="lesson-section">
                            <h3>Why Are There Multiple Values?</h3>
                            <p>Different pricing guides serve different purposes and pull data from different sources. That's why the numbers don't match exactly.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>The Different Perspectives</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Priority</th>
                                    <th>Source</th>
                                    <th>Where Data Comes From</th>
                                </tr>
                                <tr style="background: rgba(74, 222, 128, 0.2);">
                                    <td style="color: #4ade80;"><strong>#1 PRIMARY</strong></td>
                                    <td><strong>MMR</strong></td>
                                    <td>Actual Manheim auction sales - real transactions</td>
                                </tr>
                                <tr>
                                    <td><strong>#2 SECONDARY</strong></td>
                                    <td><strong>J.D. Power</strong></td>
                                    <td>Trade-in transactions at dealers</td>
                                </tr>
                                <tr>
                                    <td><strong>#3 THIRD</strong></td>
                                    <td><strong>Black Book</strong></td>
                                    <td>Dealer-to-dealer auction values</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Same Truck, Different Values</h3>
                            <div class="data-example">
                                <strong>2020 Silverado LT 4x4 | 45,000 miles | Clean</strong><br><br>

                                <table style="width: 100%;">
                                    <tr>
                                        <td>Black Book Avg:</td>
                                        <td><strong>$28,500</strong></td>
                                        <td style="color: #888;">← Wholesale (dealers pay this)</td>
                                    </tr>
                                    <tr>
                                        <td>MMR:</td>
                                        <td><strong>$29,200</strong></td>
                                        <td style="color: #888;">← Auction average</td>
                                    </tr>
                                    <tr>
                                        <td>J.D. Power Avg:</td>
                                        <td><strong>$30,800</strong></td>
                                        <td style="color: #888;">← Trade-in (retail-focused)</td>
                                    </tr>
                                </table>
                                <br>
                                <p><strong>What does this spread tell us?</strong></p>
                                <ul>
                                    <li>MMR = baseline (what it's actually trading for)</li>
                                    <li>J.D. Power = upside potential (what hot cars can bring)</li>
                                    <li>Black Book = helps see which way the scale tips</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>What This Means for You</h3>
                            <div class="highlight-box" style="border-color: #4ade80;">
                                <ul style="font-size: 1.1em; line-height: 2;">
                                    <li><strong>Black Book = Your floor</strong> - Conservative, safe value</li>
                                    <li><strong>MMR = Market reality</strong> - What's actually trading</li>
                                    <li><strong>J.D. Power = Your ceiling</strong> - Best case retail trade</li>
                                    <li><strong>Average = Your target</strong> - Balanced, realistic value</li>
                                </ul>
                            </div>
                        </div>

                        <div class="warning-box">
                            <h3>When Values Are Far Apart</h3>
                            <p>If one value is way different from the others (more than $3,000 off):</p>
                            <ul>
                                <li>Could be a rare configuration (data issue)</li>
                                <li>Market might be shifting on that model</li>
                                <li><strong>USE THE LOWER VALUES</strong> - be conservative</li>
                                <li>Better to underbid than overpay</li>
                            </ul>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">THE BOTTOM LINE:</h3>
                            <p style="font-size: 1.2em;">Different values exist because different buyers have different needs. We average them to find the TRUE market value - not the highest hope or lowest fear.</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-3-3',
                    title: 'J.D. Power & MMR Explained',
                    content: `
                        <h2>J.D. Power & MMR Explained</h2>

                        <div class="lesson-section">
                            <h3>J.D. Power Values</h3>
                            <p>J.D. Power provides <strong>trade-in values</strong> - what a dealer would give on trade.</p>
                            <table class="data-table">
                                <tr>
                                    <th>Grade</th>
                                    <th>What It Means</th>
                                </tr>
                                <tr>
                                    <td><strong>Clean Trade-In</strong></td>
                                    <td>Good condition trade value</td>
                                </tr>
                                <tr>
                                    <td><strong>Average Trade-In</strong></td>
                                    <td>Normal condition trade value</td>
                                </tr>
                                <tr>
                                    <td><strong>Rough Trade-In</strong></td>
                                    <td>Below average trade value</td>
                                </tr>
                            </table>
                            <p style="margin-top: 15px;"><strong>Note:</strong> J.D. Power values are often higher than Black Book because they're retail-focused.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>MMR (Manheim Market Report)</h3>
                            <p><strong>MMR</strong> is based on actual Manheim auction sales - real transactions, not estimates.</p>
                            <div class="info-box">
                                <h4>MMR Shows:</h4>
                                <ul>
                                    <li><strong>MMR:</strong> Average sale price at Manheim auctions</li>
                                    <li><strong>MMR Adjusted:</strong> Adjusted for mileage and condition</li>
                                    <li>Based on last 13 months of actual sales</li>
                                </ul>
                            </div>
                            <p><strong>Why MMR matters:</strong> It tells you what similar vehicles are ACTUALLY selling for right now at auction.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: All Three Sources</h3>
                            <div class="data-example">
                                <strong>2019 Ram 1500 Rebel 4x4</strong><br><br>

                                <strong>Black Book Avg:</strong> $27,800<br>
                                <strong>J.D. Power Avg:</strong> $29,500<br>
                                <strong>MMR Adjusted:</strong> $28,200<br><br>

                                All three are in the same ballpark - gives you confidence in the value.
                            </div>
                        </div>

                        <div class="warning-box">
                            <h3>When Values Don't Match</h3>
                            <p>If one value is way different from the others:</p>
                            <ul>
                                <li>Could be a data issue (rare configuration)</li>
                                <li>Market might be shifting</li>
                                <li>Use the <strong>more conservative</strong> (lower) values to be safe</li>
                            </ul>
                        </div>
                    `
                },
                {
                    id: 'lesson-3-4',
                    title: 'Calculating the Average - THE FORMULA',
                    content: `
                        <h2>Calculating the Average - THE FORMULA</h2>

                        <div class="highlight-box" style="background: #0a1a0a; border: 3px solid #4ade80; padding: 30px;">
                            <h3 style="color: #4ade80; text-align: center; font-size: 1.5em;">THE TARGET SALES PRICE FORMULA</h3>
                            <div style="text-align: center; font-size: 1.3em; margin: 20px 0;">
                                <strong>Target Sales Price = (MMR + J.D. Power + Black Book) ÷ 3</strong>
                            </div>
                            <p style="text-align: center;">Average the three values to get your Target Sales Price (at 4.0).</p>
                            <p style="text-align: center; color: #4ade80;"><strong>MMR is PRIMARY - it's actual auction sales at 4.0 score</strong></p>
                        </div>

                        <div class="lesson-section">
                            <h3>Step-by-Step Calculation</h3>
                            <ol style="font-size: 1.1em; line-height: 2;">
                                <li>Pull the Autoniq report using the VIN</li>
                                <li>Find <strong>MMR Adjusted</strong> (PRIMARY)</li>
                                <li>Find J.D. Power <strong>Average Trade-In</strong> (Secondary)</li>
                                <li>Find Black Book <strong>Average</strong> or History Adjusted Avg (Third)</li>
                                <li>Add all three together</li>
                                <li>Divide by 3</li>
                                <li>That's your <strong>Target Sales Price (at 4.0)</strong></li>
                            </ol>
                        </div>

                        <div class="lesson-section">
                            <h3>Example Calculation</h3>
                            <div class="calculation-example">
                                <strong>2022 Ram 1500 Rebel Crew Cab 4x4 | 28,706 miles</strong><br><br>

                                <span style="color: #4ade80;">MMR Adjusted (PRIMARY): <strong>$41,200</strong></span><br>
                                J.D. Power Avg Trade-In: <strong>$42,800</strong><br>
                                Black Book Avg (History Adjusted): <strong>$40,125</strong><br><br>

                                <hr style="border-color: #4ade80;">
                                <strong>Calculation:</strong><br>
                                ($41,200 + $42,800 + $40,125) ÷ 3<br>
                                = $124,125 ÷ 3<br>
                                = <span style="color: #4ade80; font-size: 1.3em;"><strong>$41,375 Book Value</strong></span>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Another Example</h3>
                            <div class="calculation-example">
                                <strong>2019 GMC Sierra SLT Crew Cab 4x4 | 52,000 miles</strong><br><br>

                                <span style="color: #4ade80;">MMR Adjusted (PRIMARY): <strong>$32,100</strong></span><br>
                                J.D. Power Avg: <strong>$33,200</strong><br>
                                Black Book Avg: <strong>$31,500</strong><br><br>

                                <hr style="border-color: #4ade80;">
                                <strong>Calculation:</strong><br>
                                ($32,100 + $33,200 + $31,500) ÷ 3<br>
                                = $96,800 ÷ 3<br>
                                = <span style="color: #4ade80; font-size: 1.3em;"><strong>$32,267 Book Value</strong></span>
                            </div>
                        </div>

                        <div class="highlight-box" style="border-color: #facc15; background: #1a1a0a;">
                            <h3 style="color: #facc15;">IMPORTANT: MMR is Baseline at 4.0 Score</h3>
                            <p>MMR calculates values assuming a <strong>4.0 CR score</strong> (clean condition).</p>
                            <p style="margin-top: 10px;"><strong>J.D. Power/NADA shows UPSIDE potential:</strong></p>
                            <ul>
                                <li>Some cars have "big NADA books" - could bring MORE than MMR</li>
                                <li>Hot cars (high demand) can bring <strong>$1,000-2,000 OVER MMR</strong></li>
                                <li>This is why we average - to capture that upside potential</li>
                            </ul>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">WHY AVERAGE ALL THREE?</h3>
                            <p>MMR = your baseline (what it's trading for). J.D. Power/NADA = upside potential (what hot cars can bring). Black Book = helps see which way the scale tips. Averaging gives you a realistic target.</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-3-4b',
                    title: 'Calculating Target Sales Price',
                    content: `
                        <h2>Calculating Target Sales Price</h2>

                        <div class="highlight-box" style="background: #0a1a0a; border: 3px solid #4ade80; padding: 30px;">
                            <h3 style="color: #4ade80; text-align: center;">TARGET SALES PRICE = What You Can Sell It For</h3>
                            <p style="text-align: center; font-size: 1.1em;">This is the number you use to calculate your max bid.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>How to Calculate Target Sales Price</h3>
                            <div class="info-box">
                                <ol style="font-size: 1.1em; line-height: 2.2;">
                                    <li><strong>Start with MMR</strong> - This is your baseline (actual auction sales at 4.0)</li>
                                    <li><strong>Look at J.D. Power</strong> - Is it higher? Shows upside potential</li>
                                    <li><strong>Look at Black Book</strong> - Which way does the scale tip?</li>
                                    <li><strong>Compare all three</strong> - See where they cluster</li>
                                    <li><strong>Calculate the average</strong> - (MMR + JDP + BB) ÷ 3</li>
                                </ol>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Reading the Scale</h3>
                            <table class="data-table">
                                <tr>
                                    <th>If You See...</th>
                                    <th>What It Means</th>
                                    <th>Target Sales Price</th>
                                </tr>
                                <tr>
                                    <td>JDP & BB both ABOVE MMR</td>
                                    <td style="color: #4ade80;">Strong upside - hot car</td>
                                    <td>Could bring $1,000-2,000 over MMR</td>
                                </tr>
                                <tr>
                                    <td>JDP above, BB below MMR</td>
                                    <td style="color: #facc15;">Mixed signals - use average</td>
                                    <td>Use the average of all three</td>
                                </tr>
                                <tr>
                                    <td>JDP & BB both BELOW MMR</td>
                                    <td style="color: #e94560;">Downside risk - be careful</td>
                                    <td>Use the lower values, be conservative</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Hot Car (Big NADA Book)</h3>
                            <div class="calculation-example" style="border-color: #4ade80;">
                                <strong>2021 Ram 1500 Rebel 4x4 (HIGH DEMAND)</strong><br><br>

                                MMR: <strong>$38,000</strong> (baseline)<br>
                                J.D. Power: <strong>$40,500</strong> (+$2,500 over MMR)<br>
                                Black Book: <strong>$39,200</strong> (+$1,200 over MMR)<br><br>

                                <strong>Scale tips UP</strong> - Both JDP and BB are above MMR!<br><br>

                                <hr style="border-color: #4ade80;">
                                Average: ($38,000 + $40,500 + $39,200) ÷ 3 = <strong>$39,233</strong><br><br>

                                <span style="color: #4ade80; font-size: 1.2em;"><strong>Target Sales Price: $39,200</strong></span><br>
                                <span style="color: #888;">This hot car could bring ~$1,200 over MMR</span>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Average Car</h3>
                            <div class="calculation-example" style="border-color: #facc15;">
                                <strong>2019 Silverado LT 4x4</strong><br><br>

                                MMR: <strong>$28,500</strong> (baseline)<br>
                                J.D. Power: <strong>$29,800</strong> (+$1,300)<br>
                                Black Book: <strong>$27,900</strong> (-$600)<br><br>

                                <strong>Scale is balanced</strong> - JDP up, BB down<br><br>

                                <hr style="border-color: #facc15;">
                                Average: ($28,500 + $29,800 + $27,900) ÷ 3 = <strong>$28,733</strong><br><br>

                                <span style="color: #facc15; font-size: 1.2em;"><strong>Target Sales Price: $28,700</strong></span><br>
                                <span style="color: #888;">Right around MMR - use the average</span>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Cold Car (Scale Tips Down)</h3>
                            <div class="calculation-example" style="border-color: #e94560;">
                                <strong>2018 Sierra SLT 2WD Extended Cab</strong><br><br>

                                MMR: <strong>$22,000</strong> (baseline)<br>
                                J.D. Power: <strong>$21,200</strong> (-$800)<br>
                                Black Book: <strong>$20,500</strong> (-$1,500)<br><br>

                                <strong>Scale tips DOWN</strong> - Both below MMR = cold car<br><br>

                                <hr style="border-color: #e94560;">
                                Average: ($22,000 + $21,200 + $20,500) ÷ 3 = <strong>$21,233</strong><br><br>

                                <span style="color: #e94560; font-size: 1.2em;"><strong>Target Sales Price: $21,000</strong></span><br>
                                <span style="color: #888;">Be conservative - use lower number. This will sit.</span>
                            </div>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">THE FORMULA</h3>
                            <div style="font-size: 1.2em; text-align: center; padding: 15px;">
                                <strong>Target Sales Price = Average of (MMR + J.D. Power + Black Book)</strong><br><br>
                                Then: <strong>Max Bid = Target Sales Price - $3,000 - Rehab</strong>
                            </div>
                        </div>
                    `
                },
                {
                    id: 'lesson-3-5',
                    title: 'Using History Adjusted Values',
                    content: `
                        <h2>Using History Adjusted Values</h2>

                        <div class="highlight-box" style="background: #1a3a1a; border: 2px solid #4ade80; padding: 25px;">
                            <h3 style="color: #4ade80;">History Adjusted = The REAL Value</h3>
                            <p>Black Book's History Adjusted value already accounts for accidents, owners, and title issues. <strong>USE THIS VALUE!</strong></p>
                        </div>

                        <div class="lesson-section">
                            <h3>What History Adjusted Accounts For</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Factor</th>
                                    <th>Impact on Value</th>
                                </tr>
                                <tr>
                                    <td><strong>Accidents</strong></td>
                                    <td>Each accident reduces value</td>
                                </tr>
                                <tr>
                                    <td><strong>Number of Owners</strong></td>
                                    <td>More owners = lower value</td>
                                </tr>
                                <tr>
                                    <td><strong>Title Issues</strong></td>
                                    <td>Salvage/rebuilt = major reduction</td>
                                </tr>
                                <tr>
                                    <td><strong>Frame Damage</strong></td>
                                    <td>Significant reduction</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Base vs History Adjusted</h3>
                            <div class="data-example">
                                <strong>2017 Silverado LTZ | 2 accidents, 4 owners</strong><br><br>

                                <strong>Black Book Base Values:</strong><br>
                                Avg: $24,500<br><br>

                                <strong>Black Book History Adjusted:</strong><br>
                                Avg: <span style="color: #e94560;"><strong>$21,200</strong></span><br><br>

                                <strong>Difference: $3,300 less due to history!</strong>
                            </div>
                            <p style="margin-top: 15px;">If you used the base value, you'd overpay by $3,300. Always use History Adjusted.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>When History Adjusted Isn't Available</h3>
                            <p>Sometimes Autoniq can't pull history (VIN issue, too new, etc.). In that case:</p>
                            <ul>
                                <li>Use base values as starting point</li>
                                <li>Manually check Carfax/AutoCheck</li>
                                <li>Deduct approximately:
                                    <ul>
                                        <li>$1,000-1,500 per accident</li>
                                        <li>$500 for 4+ owners</li>
                                    </ul>
                                </li>
                                <li>Be more conservative on your bid</li>
                            </ul>
                        </div>

                        <div class="warning-box">
                            <h3 style="color: #e94560;">NEVER Ignore History</h3>
                            <p>A clean-looking truck with 3 accidents will NOT sell for clean truck money. The buyer will check Carfax. The history follows the vehicle forever.</p>
                        </div>

                        <div class="key-point">
                            <h3>THE RULE:</h3>
                            <p style="font-size: 1.2em;">Always use History Adjusted when available. It's already done the math. Don't double-deduct!</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-3-5b',
                    title: 'Understanding Carfax & AutoCheck',
                    content: `
                        <h2>Understanding Carfax & AutoCheck</h2>

                        <div class="lesson-section">
                            <h3>Why Check Both?</h3>
                            <p>Carfax and AutoCheck pull from different data sources. One might catch something the other misses.</p>
                            <div class="highlight-box" style="border-color: #818cf8;">
                                <p style="font-size: 1.1em;"><strong>ALWAYS check BOTH reports before bidding.</strong> Accidents, title issues, or odometer problems could be on one but not the other.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>What Each Report Shows</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Information</th>
                                    <th>Carfax</th>
                                    <th>AutoCheck</th>
                                </tr>
                                <tr>
                                    <td>Accident history</td>
                                    <td>✓</td>
                                    <td>✓</td>
                                </tr>
                                <tr>
                                    <td>Number of owners</td>
                                    <td>✓</td>
                                    <td>✓</td>
                                </tr>
                                <tr>
                                    <td>Service records</td>
                                    <td>✓ (more detailed)</td>
                                    <td>✓</td>
                                </tr>
                                <tr>
                                    <td>Title issues</td>
                                    <td>✓</td>
                                    <td>✓</td>
                                </tr>
                                <tr>
                                    <td>Odometer readings</td>
                                    <td>✓</td>
                                    <td>✓</td>
                                </tr>
                                <tr>
                                    <td>Auction history</td>
                                    <td>Limited</td>
                                    <td>✓ (more auction data)</td>
                                </tr>
                                <tr>
                                    <td>Score/Rating</td>
                                    <td>No score</td>
                                    <td>AutoCheck Score</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Red Flags to Watch For</h3>
                            <div class="warning-box">
                                <h4 style="color: #e94560;">DEAL BREAKERS:</h4>
                                <ul>
                                    <li><strong>Salvage/Rebuilt Title</strong> - Massive value drop, hard to sell</li>
                                    <li><strong>Frame Damage</strong> - Structural issues, liability risk</li>
                                    <li><strong>Flood/Fire Damage</strong> - Hidden problems will surface</li>
                                    <li><strong>Odometer Rollback</strong> - Fraud, legal issues</li>
                                    <li><strong>Lemon/Buyback</strong> - Manufacturer defect history</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Yellow Flags (Evaluate Carefully)</h3>
                            <div class="info-box">
                                <ul>
                                    <li><strong>Multiple accidents</strong> - Each one drops value</li>
                                    <li><strong>4+ owners</strong> - Why does nobody keep it?</li>
                                    <li><strong>Rental/Fleet use</strong> - Higher wear, but can be okay</li>
                                    <li><strong>Long gaps in service</strong> - Possible neglect</li>
                                    <li><strong>Airbag deployment</strong> - Serious accident indicator</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>How History Affects Value</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Issue</th>
                                    <th>Approximate Value Impact</th>
                                </tr>
                                <tr>
                                    <td>1 minor accident</td>
                                    <td>-$1,000 to -$1,500</td>
                                </tr>
                                <tr>
                                    <td>1 moderate accident</td>
                                    <td>-$1,500 to -$2,500</td>
                                </tr>
                                <tr>
                                    <td>2+ accidents</td>
                                    <td>-$2,500 to -$4,000+</td>
                                </tr>
                                <tr>
                                    <td>4+ owners</td>
                                    <td>-$500 to -$1,000</td>
                                </tr>
                                <tr>
                                    <td>Rental history</td>
                                    <td>-$500 to -$1,000</td>
                                </tr>
                            </table>
                            <p style="margin-top: 15px;"><strong>Remember:</strong> Black Book History Adjusted values already factor these in - don't double deduct!</p>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">THE RULE:</h3>
                            <p style="font-size: 1.2em;">Check Carfax AND AutoCheck on every vehicle. History Adjusted book values account for this - but you need to know what you're buying.</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-3-6',
                    title: 'Putting It All Together',
                    content: `
                        <h2>Putting It All Together</h2>

                        <div class="lesson-section">
                            <h3>Complete Book Value Process</h3>
                            <div class="highlight-box" style="border-color: #818cf8;">
                                <ol style="font-size: 1.1em; line-height: 2.2;">
                                    <li><strong>Get the VIN</strong> from the OVE listing</li>
                                    <li><strong>Pull Autoniq report</strong> using the VIN</li>
                                    <li><strong>Check if History Adjusted</strong> values are available</li>
                                    <li><strong>Find these three values:</strong>
                                        <ul>
                                            <li>Black Book Avg (History Adjusted if available)</li>
                                            <li>J.D. Power Avg Trade-In</li>
                                            <li>MMR Adjusted</li>
                                        </ul>
                                    </li>
                                    <li><strong>Calculate the average:</strong> Add all three ÷ 3</li>
                                    <li><strong>That's your Target Sales Price</strong> for the max bid formula</li>
                                </ol>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Full Example with Real Numbers</h3>
                            <div class="calculation-example" style="background: #0a1a0a; border: 2px solid #4ade80;">
                                <h4 style="color: #4ade80;">Vehicle: 2019 Ram 1500 Rebel 4x4</h4>
                                <p>VIN: 1C6SRFET0KN822590 | 45,282 miles | 1 accident</p>
                                <br>

                                <strong>Step 1: Pull Autoniq Values</strong><br>
                                Black Book Avg (History Adjusted): $29,575<br>
                                J.D. Power Avg Trade-In: $31,200<br>
                                MMR Adjusted: $30,100<br><br>

                                <strong>Step 2: Calculate Average</strong><br>
                                ($29,575 + $31,200 + $30,100) ÷ 3<br>
                                = $90,875 ÷ 3<br>
                                = <strong>$30,292</strong><br><br>

                                <strong>Step 3: Round to Clean Number</strong><br>
                                Book Value = <span style="color: #4ade80; font-size: 1.3em;"><strong>$30,300</strong></span><br><br>

                                <strong>Step 4: Apply Max Bid Formula</strong><br>
                                $30,300 - $3,000 (spread) - $1,500 (rehab)<br>
                                = <span style="color: #facc15; font-size: 1.3em;"><strong>$25,800 Max Bid</strong></span>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Quick Reference: What to Look For</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Priority</th>
                                    <th>Source</th>
                                    <th>Value to Use</th>
                                </tr>
                                <tr style="background: rgba(74, 222, 128, 0.2);">
                                    <td style="color: #4ade80;"><strong>#1 PRIMARY</strong></td>
                                    <td>MMR</td>
                                    <td><strong>MMR Adjusted</strong> (baseline at 4.0)</td>
                                </tr>
                                <tr>
                                    <td><strong>#2</strong></td>
                                    <td>J.D. Power</td>
                                    <td><strong>Avg Trade-In</strong> (shows upside)</td>
                                </tr>
                                <tr>
                                    <td><strong>#3</strong></td>
                                    <td>Black Book</td>
                                    <td><strong>Avg (History Adjusted)</strong></td>
                                </tr>
                            </table>
                            <p style="margin-top: 15px;"><strong>Remember:</strong> Hot cars with big NADA books can bring $1,000-2,000 over MMR!</p>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">MASTER THIS!</h3>
                            <p style="font-size: 1.2em;">Book value calculation is the foundation of every deal. Get this right and the rest is easy. Get it wrong and you'll lose money every time.</p>
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-3',
                title: 'Understanding Book Values Quiz',
                questions: [
                    {
                        question: 'What three sources do we average to get Book Value, and which is PRIMARY?',
                        options: [
                            'Carfax, AutoCheck, and KBB - Carfax is primary',
                            'MMR (primary), J.D. Power (secondary), Black Book (third)',
                            'Black Book (primary), MMR (secondary), J.D. Power (third)',
                            'XClean, Clean, and Average - XClean is primary'
                        ],
                        correct: 1,
                        explanation: 'MMR is PRIMARY (actual auction sales at 4.0 score), J.D. Power is secondary (shows upside potential), Black Book is third. We average all three.'
                    },
                    {
                        question: 'Black Book shows: Avg $28,000. J.D. Power Avg: $30,000. MMR: $29,000. What is the Book Value?',
                        options: [
                            '$28,000',
                            '$29,000',
                            '$30,000',
                            '$87,000'
                        ],
                        correct: 1,
                        explanation: '($28,000 + $30,000 + $29,000) ÷ 3 = $87,000 ÷ 3 = $29,000'
                    },
                    {
                        question: 'What does "History Adjusted" value account for?',
                        options: [
                            'Only mileage',
                            'Accidents, number of owners, and title issues',
                            'Only the color of the vehicle',
                            'The dealer\'s profit margin'
                        ],
                        correct: 1,
                        explanation: 'History Adjusted values already account for accidents, number of owners, and title issues. Always use this value when available!'
                    },
                    {
                        question: 'A truck has Black Book base Avg of $25,000 but History Adjusted Avg of $22,000. Which should you use?',
                        options: [
                            '$25,000 - it\'s higher',
                            '$22,000 - History Adjusted is the real value',
                            'Average them: $23,500',
                            'Neither - use KBB instead'
                        ],
                        correct: 1,
                        explanation: 'Always use History Adjusted when available. It already accounts for accidents and owners. The $22,000 is the real market value.'
                    },
                    {
                        question: 'Black Book has 4 condition grades. Which one do we typically use for a CR 2.8 vehicle?',
                        options: [
                            'XClean',
                            'Clean',
                            'Average',
                            'Rough'
                        ],
                        correct: 2,
                        explanation: 'CR 2.0-2.9 matches with Black Book Average condition. The CR grade helps you pick the right value column.'
                    },
                    {
                        question: 'You pull Autoniq and get: BB Avg $31,500, JDP Avg $33,200, MMR $32,100. What is the Book Value?',
                        options: [
                            '$31,500',
                            '$32,267',
                            '$33,200',
                            '$32,100'
                        ],
                        correct: 1,
                        explanation: '($31,500 + $33,200 + $32,100) ÷ 3 = $96,800 ÷ 3 = $32,267 (round to $32,300)'
                    },
                    {
                        question: 'What is MMR based on?',
                        options: [
                            'Dealer opinions',
                            'Actual Manheim auction sales data',
                            'Retail listings on AutoTrader',
                            'Insurance company estimates'
                        ],
                        correct: 1,
                        explanation: 'MMR (Manheim Market Report) is based on actual auction sales at Manheim - real transactions, not estimates.'
                    }
                ]
            }
        },
        {
            id: 'module-4',
            title: 'Pricing & Profit Calculations',
            lessons: [
                {
                    id: 'lesson-4-1',
                    title: 'Using Autoniq to Find Target Sales Price',
                    content: `
                        <h2>Using Autoniq to Find Target Sales Price</h2>

                        <div class="lesson-section">
                            <h3>What is Autoniq?</h3>
                            <p><strong>Autoniq</strong> is a book scanner tool that pulls values from multiple pricing guides in one place. This is how we determine what a vehicle is worth.</p>
                            <p>Enter the VIN into Autoniq and it will show you values from:</p>
                            <ul>
                                <li><strong>Black Book</strong> - Wholesale values (XClean, Clean, Avg, Rough)</li>
                                <li><strong>J.D. Power</strong> - Trade-in values (Clean, Avg, Rough)</li>
                                <li><strong>MMR</strong> - Manheim Market Report (auction sales data)</li>
                                <li><strong>Retail Index</strong> - Local retail market pricing</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Calculating Target Sales Price</h3>
                            <p>Your <strong>Target Sales Price</strong> is the average of the relevant book values from Autoniq.</p>
                            <p>Look at the "Clean" and "Avg" columns across the different books and average them together. This gives you a realistic expectation of what you can sell the vehicle for.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Reading Autoniq Values</h3>
                            <div class="data-example">
                                <strong>2014 Ram 1500 Longhorn Limited | 67,761 miles</strong><br><br>

                                <strong>Black Book (Wholesale):</strong><br>
                                XClean: $19,050 | Clean: $17,050 | Avg: $14,150 | Rough: $11,475<br><br>

                                <strong>J.D. Power (Trade-In):</strong><br>
                                Clean: $27,750 | Avg: $26,450 | Rough: $24,850<br><br>

                                <strong>MMR Adjusted:</strong> $21,400<br>
                                <strong>Retail Index Avg:</strong> $16,621
                            </div>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Always pull the Autoniq report BEFORE bidding. The book values tell you what the market will pay.
                        </div>
                    `
                },
                {
                    id: 'lesson-3-2',
                    title: 'The Carz Inc Pricing Formula',
                    content: `
                        <h2>The Carz Inc Pricing Formula</h2>

                        <div class="lesson-section" style="background: linear-gradient(135deg, #1a0a0a, #2a1515); border: 2px solid #e94560; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                            <h3 style="color: #e94560; margin-top: 0;">STEP 1: Check for $3,000 Spread FIRST</h3>
                            <p style="font-size: 1.1em;"><strong>Before you look at ANYTHING else, do this quick check:</strong></p>
                            <div class="formula-box" style="background: #0a0a1a;">
                                <strong>Book Value − Buy Now Price ≥ $3,000?</strong>
                            </div>
                            <p style="margin-top: 15px;">
                                <span style="color: #e94560; font-weight: bold;">NO?</span> → <strong>SKIP THIS CAR. Don't waste your time.</strong> Move to the next vehicle.<br><br>
                                <span style="color: #4ade80; font-weight: bold;">YES?</span> → Continue evaluating. Check history, CR, estimate rehab.
                            </p>
                            <p style="color: #facc15; margin-top: 15px;"><strong>Why?</strong> If there's no $3,000 spread from the start, there's NO room for profit after fees. The $3,000 covers your fees (~$1,900) + profit (~$1,000). No spread = no deal.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>STEP 2: Subtract Rehab ON TOP</h3>
                            <p>Once you confirm a $3,000 spread exists, estimate rehab costs and subtract them:</p>

                            <div class="formula-box">
                                <strong>Max Bid = Book Value - $3,000 (fees + profit) - Rehab Costs</strong>
                            </div>
                            <p style="margin-top: 10px;"><em>Rehab is EXTRA. It comes out of the remaining spread after the $3,000.</em></p>
                        </div>

                        <div class="lesson-section">
                            <h3>What's in the $3,000?</h3>
                            <p>The $3,000 minimum spread covers all your fees plus profit:</p>

                            <table class="data-table">
                                <tr>
                                    <th>Fee Type</th>
                                    <th>Amount</th>
                                </tr>
                                <tr>
                                    <td>Office Fees</td>
                                    <td>$200</td>
                                </tr>
                                <tr>
                                    <td>Shipping (500mi typical × $0.80)</td>
                                    <td>$400</td>
                                </tr>
                                <tr>
                                    <td>Lot Fees</td>
                                    <td>$200</td>
                                </tr>
                                <tr>
                                    <td>Auction Buy Fee</td>
                                    <td>$700</td>
                                </tr>
                                <tr>
                                    <td>Auction Sell Fee</td>
                                    <td>$200</td>
                                </tr>
                                <tr>
                                    <td>Floor Plan Fees (avg)</td>
                                    <td>$200</td>
                                </tr>
                                <tr style="background: #0f3460;">
                                    <td><strong>Fees Subtotal</strong></td>
                                    <td><strong>$1,900</strong></td>
                                </tr>
                                <tr>
                                    <td><strong>Profit Target</strong></td>
                                    <td><strong>$1,000</strong></td>
                                </tr>
                                <tr class="total-row">
                                    <td><strong>TOTAL MINIMUM SPREAD</strong></td>
                                    <td><strong>~$3,000</strong></td>
                                </tr>
                            </table>

                            <div class="key-point">
                                <strong>Note:</strong> Actual fees total ~$1,900 + $1,000 profit = ~$2,900. We round to $3,000 for a small buffer against surprises.
                            </div>

                            <p><em>This $3,000 does NOT include rehab/reconditioning - that's added separately!</em></p>
                        </div>

                        <div class="lesson-section">
                            <h3>Floor Plan Warning: The Hidden Profit Killer</h3>
                            <div class="warning-box">
                                <p>Floor plan fees <strong>accumulate over time</strong>. The $200 in our formula assumes a 30-day sale. If a truck sits longer:</p>
                                <table class="data-table">
                                    <tr>
                                        <th>Days on Lot</th>
                                        <th>Floor Plan Cost</th>
                                        <th>Your Profit Left</th>
                                    </tr>
                                    <tr style="background: rgba(74, 222, 128, 0.1);">
                                        <td>30 days</td>
                                        <td>$200</td>
                                        <td>$1,000 (target)</td>
                                    </tr>
                                    <tr style="background: rgba(250, 204, 21, 0.1);">
                                        <td>60 days</td>
                                        <td>$400</td>
                                        <td>$800</td>
                                    </tr>
                                    <tr style="background: rgba(250, 204, 21, 0.1);">
                                        <td>90 days</td>
                                        <td>$600</td>
                                        <td>$600</td>
                                    </tr>
                                    <tr style="background: rgba(233, 69, 96, 0.1);">
                                        <td>120 days</td>
                                        <td>$800</td>
                                        <td>$400</td>
                                    </tr>
                                </table>
                                <p style="margin-top: 15px;"><strong>This is why configuration matters!</strong> A 2WD truck that sits 90 days costs you $400 in extra floor plan fees. A 4WD crew cab that sells in 25 days saves you money.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example Calculation</h3>
                            <div class="calculation-example">
                                <strong>Vehicle:</strong> 2021 Silverado LTZ<br>
                                <strong>Target Sales Price (avg of books):</strong> $32,000<br>
                                <strong>Estimated Rehab:</strong> $1,500<br><br>

                                Target Sales Price: $32,000<br>
                                - Minimum Spread: $3,000<br>
                                - Rehab Costs: $1,500<br>
                                ───────────────────<br>
                                <strong>Maximum Bid: $27,500</strong>
                            </div>
                            <p>If you can buy it for LESS than $27,500, your profit increases!</p>
                        </div>

                        <div class="warning-box">
                            <strong>NEVER exceed your max bid.</strong> If the auction price goes above your number, walk away. There will always be another truck.
                        </div>
                    `
                },
                {
                    id: 'lesson-3-3',
                    title: 'Shipping Costs (Per Mile)',
                    content: `
                        <h2>Shipping Costs (Per Mile)</h2>

                        <div class="lesson-section">
                            <h3>The Shipping Rate</h3>
                            <p>Transportation costs approximately <strong>$0.80 per mile</strong> from the auction to your location.</p>

                            <div class="formula-box">
                                <strong>Shipping Cost = Distance (miles) × $0.80</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Quick Reference Table</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Distance</th>
                                    <th>Shipping Cost</th>
                                </tr>
                                <tr>
                                    <td>100 miles</td>
                                    <td>$80</td>
                                </tr>
                                <tr>
                                    <td>250 miles</td>
                                    <td>$200</td>
                                </tr>
                                <tr>
                                    <td>500 miles</td>
                                    <td>$400</td>
                                </tr>
                                <tr>
                                    <td>1,000 miles</td>
                                    <td>$800</td>
                                </tr>
                                <tr>
                                    <td>1,500 miles</td>
                                    <td>$1,200</td>
                                </tr>
                                <tr>
                                    <td>2,000 miles</td>
                                    <td>$1,600</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Shipping is Part of Your $2,000 Fees</h3>
                            <p>Remember: shipping is already factored into the $2,000 fees portion of your $3,000 spread. However, if shipping exceeds the normal budget (very long distances), you need to adjust your max bid accordingly.</p>

                            <div class="data-example">
                                <strong>Example:</strong><br>
                                Buying from CA - Canoga Park to your lot<br>
                                Distance: ~2,000 miles<br>
                                Shipping: 2,000 × $0.80 = $1,600<br><br>
                                <em>This is a significant cost - make sure the deal is worth it!</em>
                            </div>
                        </div>

                        <div class="key-point">
                            <strong>Pro Tip:</strong> Buying closer to home means more of your $3,000 spread goes to profit instead of shipping.
                        </div>
                    `
                },
                {
                    id: 'lesson-3-4',
                    title: 'Estimating Rehab Costs',
                    content: `
                        <h2>Estimating Rehab Costs</h2>

                        <div class="lesson-section">
                            <h3>Rehab is EXTRA - Not Included in $3,000</h3>
                            <p>Your $3,000 minimum spread covers fees and profit. <strong>Rehab/reconditioning costs are additional</strong> and must be subtracted from your max bid.</p>

                            <div class="formula-box">
                                <strong>Max Bid = Target Sales Price - $3,000 - Rehab</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Estimating Rehab by CR Grade</h3>
                            <div class="info-box" style="margin-bottom: 15px;">
                                <p><strong>Note:</strong> These are TOTAL added costs (rehab + dealer fees). Roughly <strong>$1,000 per grade level</strong> below 4.0.</p>
                            </div>
                            <table class="data-table">
                                <tr>
                                    <th>CR Grade</th>
                                    <th>Total Added Cost</th>
                                    <th>What to Expect</th>
                                </tr>
                                <tr>
                                    <td>4.0+</td>
                                    <td>~$500</td>
                                    <td>Detail, minor touch-up only</td>
                                </tr>
                                <tr>
                                    <td>3.0-3.9</td>
                                    <td>~$1,500</td>
                                    <td>1 grade below = ~$1,000 added</td>
                                </tr>
                                <tr>
                                    <td>2.5-2.9</td>
                                    <td>~$2,000-2,500</td>
                                    <td>Our sweet spot - good discounts</td>
                                </tr>
                                <tr>
                                    <td>2.0-2.4</td>
                                    <td>~$2,500-3,000</td>
                                    <td>Significant work needed</td>
                                </tr>
                                <tr>
                                    <td>Below 2.0</td>
                                    <td>$3,000-3,500+</td>
                                    <td>Major rehab - evaluate carefully</td>
                                </tr>
                            </table>
                            <p style="margin-top: 10px; color: #888;"><em>Average rehab cost per vehicle: ~$3,495 (includes all dealer fees)</em></p>
                        </div>

                        <div class="lesson-section">
                            <h3>Common Rehab Items & Costs</h3>
                            <ul>
                                <li><strong>Full detail:</strong> $200-400</li>
                                <li><strong>Ozone treatment (smoke odor):</strong> $100</li>
                                <li><strong>Oil change + inspection:</strong> $100-200</li>
                                <li><strong>New tires (set of 4):</strong>
                                    <ul style="margin-top: 5px;">
                                        <li>Sedans: $160 ($40/tire)</li>
                                        <li>SUVs: $280 ($70/tire)</li>
                                        <li>Trucks: $400 ($100/tire)</li>
                                        <li>Sports cars: $800 ($200/tire)</li>
                                    </ul>
                                </li>
                                <li><strong>Brake pads + rotors:</strong> $400-800</li>
                                <li><strong>PDR (dent removal):</strong> $75-150 per panel</li>
                                <li><strong>Touch-up paint:</strong> $100-300</li>
                                <li><strong>Windshield replacement:</strong> $200-500</li>
                                <li><strong>Coolant bypass valve (like on Ram):</strong> $300-600</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Reading the Condition Report for Rehab</h3>
                            <p>The OVE condition report tells you exactly what needs work:</p>
                            <div class="data-example">
                                <strong>Example CR Issues:</strong><br>
                                - 13 Exterior issues (dents, scratches, paint) → Budget $500-1,000<br>
                                - 2 Diagnostic codes (engine coolant bypass valve) → Budget $400-600<br>
                                - Active leaks → Budget $200-500<br>
                                - Wheel cosmetic damage → Budget $100-200<br><br>
                                <strong>Total Rehab Estimate: $1,200-2,300</strong>
                            </div>
                        </div>

                        <div class="warning-box">
                            <strong>Always overestimate rehab.</strong> Surprises happen. If you budget $1,500 and it costs $1,200, you made extra profit. If you budget $1,000 and it costs $1,500, you lost money.
                        </div>

                        <div class="lesson-section">
                            <h3>One-Stop Rehab = Ideal Cars</h3>
                            <p>We're looking for <strong>ONE REHAB STOP</strong> cars. The more places a car has to go, the more it kills your profit.</p>

                            <div class="success-box">
                                <strong>GOOD - One Stop Cars:</strong>
                                <ul style="margin: 10px 0 0 20px;">
                                    <li>Just needs detail → Detail shop only</li>
                                    <li>Just needs tires/brakes → Mechanic only</li>
                                    <li>Just needs dent removal → Body shop only</li>
                                    <li>Just needs paint touch-up → Body shop only</li>
                                </ul>
                            </div>

                            <div class="danger-box">
                                <strong>KILLERS - Multiple Stop Cars:</strong>
                                <ul style="margin: 10px 0 0 20px;">
                                    <li>Mechanic shop + Body shop = KILLER</li>
                                    <li>Multiple mechanical issues = KILLER</li>
                                    <li>Body work + Paint + Mechanical = KILLER</li>
                                    <li>Anything that needs 3+ different vendors = KILLER</li>
                                </ul>
                                <p style="margin-top: 10px;"><strong>Why?</strong> More stops = more time sitting, more coordination, more surprises, more cost overruns. Each additional stop compounds the risk.</p>
                            </div>

                            <div class="key-point">
                                <strong>The Rule:</strong> If a car needs BOTH the mechanic shop AND the body shop, think twice. The rehab estimate is almost always too low on multi-stop cars.
                            </div>
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-3',
                title: 'Module 3 Quiz',
                questions: [
                    {
                        question: 'What is the minimum spread required between Target Sales Price and Purchase Price at Carz Inc?',
                        options: [
                            '$1,000',
                            '$2,000',
                            '$3,000 plus rehab costs',
                            '$5,000'
                        ],
                        correct: 2,
                        explanation: 'The minimum spread is $3,000 ($2,000 fees + $1,000 profit) PLUS whatever rehab the vehicle needs.'
                    },
                    {
                        question: 'What does the $3,000 minimum spread cover?',
                        options: [
                            'Just profit',
                            'Just shipping',
                            '$2,000 in fees (office, shipping, lot, auction, floorplan) + $1,000 profit',
                            'Rehab costs only'
                        ],
                        correct: 2,
                        explanation: 'The $3,000 covers $2,000 in various fees plus $1,000 minimum profit. Rehab is additional.'
                    },
                    {
                        question: 'What is the approximate shipping cost per mile?',
                        options: [
                            '$0.50 per mile',
                            '$0.80 per mile',
                            '$1.00 per mile',
                            '$1.50 per mile'
                        ],
                        correct: 1,
                        explanation: 'Shipping costs approximately $0.80 per mile from the auction to your location.'
                    },
                    {
                        question: 'Target Sales Price is $25,000. Estimated rehab is $2,000. What is your maximum bid?',
                        options: [
                            '$22,000',
                            '$23,000',
                            '$20,000',
                            '$25,000'
                        ],
                        correct: 2,
                        explanation: '$25,000 - $3,000 (minimum spread) - $2,000 (rehab) = $20,000 maximum bid'
                    },
                    {
                        question: 'A vehicle is 1,000 miles away. What is the estimated shipping cost?',
                        options: [
                            '$500',
                            '$800',
                            '$1,000',
                            '$1,200'
                        ],
                        correct: 1,
                        explanation: '1,000 miles × $0.80 = $800 shipping cost'
                    },
                    {
                        question: 'A CR Grade 2.8 vehicle will typically have how much in TOTAL added costs (rehab + fees)?',
                        options: [
                            '$500-1,000',
                            '$2,000-2,500',
                            '$3,500-4,000',
                            '$5,000+'
                        ],
                        correct: 1,
                        explanation: 'A 2.8 CR grade falls in the 2.5-2.9 range = ~$2,000-2,500 total added costs (rehab + dealer fees). This is our sweet spot - roughly $1,000 per grade level below 4.0.'
                    },
                    {
                        question: 'A car needs new brakes AND has body damage requiring paint work. What type of car is this?',
                        options: [
                            'One-stop rehab car - good buy',
                            'Multi-stop killer - think twice',
                            'Easy flip - buy it',
                            'No rehab needed'
                        ],
                        correct: 1,
                        explanation: 'This car needs BOTH a mechanic shop (brakes) AND a body shop (paint). Multi-stop cars are killers - more time, more coordination, more surprises, more cost overruns.'
                    }
                ]
            }
        },
        {
            id: 'module-4',
            title: 'Bidding Strategies',
            lessons: [
                {
                    id: 'lesson-4-1',
                    title: 'Buy Now vs. Bidding',
                    content: `
                        <h2>Buy Now vs. Bidding</h2>

                        <div class="lesson-section">
                            <h3>Buy Now Option</h3>
                            <p>Many OVE listings have a "Buy Now" price - a fixed price to purchase immediately.</p>

                            <div class="data-example">
                                <strong>Example:</strong><br>
                                2022 Ram 1500 Rebel<br>
                                Current Bid: $32,500<br>
                                Buy Now: $33,000<br>
                                MMR: $33,200
                            </div>

                            <p><strong>When to use Buy Now:</strong></p>
                            <ul>
                                <li><strong>ONLY if the Buy Now price fits your formula:</strong> Book Value - $3,000 - Rehab</li>
                                <li>The numbers work at Buy Now price - you still make your target profit</li>
                                <li>High-demand vehicle that will get bid up past your max anyway</li>
                                <li>You've done all your research and the deal makes sense at that price</li>
                            </ul>

                            <div class="warning-box">
                                <strong>Important:</strong> Never use Buy Now just because it's "below MMR" or because you want the vehicle. The Buy Now price must fit within your calculated max bid based on YOUR formula, not just market value.
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>When to Bid Instead</h3>
                            <ul>
                                <li>Buy Now price doesn't fit your formula</li>
                                <li>You might win it for less by bidding</li>
                                <li>Vehicle has issues that limit buyer interest - you may get it cheaper</li>
                                <li>You're okay losing it if someone else bids higher</li>
                            </ul>
                        </div>

                        <div class="highlight-box" style="background: #0a1a0a; border: 3px solid #4ade80; padding: 25px;">
                            <h3 style="color: #4ade80;">BIDDING CAN SAVE YOU $500 = $500 MORE PROFIT</h3>
                            <p>If the auction ends soon and there's not much bidding activity, you might win for LESS than Buy Now.</p>
                            <div class="calculation-example" style="margin-top: 15px;">
                                <strong>Example:</strong><br>
                                Buy Now: $25,000<br>
                                Your Max Bid: $24,500<br>
                                Auction ends in 2 hours, current bid is $23,800<br><br>
                                <strong>If you bid and win at $24,000:</strong><br>
                                You saved $1,000 vs Buy Now<br>
                                That's $1,000 MORE PROFIT in your pocket!
                            </div>
                            <p style="margin-top: 15px;"><strong>The risk:</strong> Someone else might outbid you. But that's okay - there's always another truck.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Proxy Bidding</h3>
                            <p>OVE uses proxy bidding - you set your maximum, and the system bids incrementally up to that amount.</p>
                            <ul>
                                <li>Set your max bid based on your calculations</li>
                                <li>Don't get emotional and raise it</li>
                                <li><strong>If you're outbid, LET IT GO</strong></li>
                            </ul>
                        </div>

                        <div class="warning-box" style="border: 3px solid #e94560;">
                            <h3 style="color: #e94560;">DON'T CHASE - LET IT GO</h3>
                            <p style="font-size: 1.1em;">If someone outbids you:</p>
                            <ul>
                                <li><strong>DO NOT raise your bid</strong></li>
                                <li>Your max bid was calculated for a reason</li>
                                <li>Chasing = emotional bidding = losing money</li>
                                <li>There are thousands of vehicles every week</li>
                            </ul>
                            <p style="margin-top: 15px; font-size: 1.2em; color: #e94560;"><strong>LOSING A DEAL IS BETTER THAN LOSING MONEY</strong></p>
                        </div>

                        <div class="lesson-section">
                            <h3>When You're Within $500 of Max Bid</h3>
                            <p>Before stretching that extra few hundred, ask yourself:</p>
                            <div class="info-box">
                                <ol style="font-size: 1.1em; line-height: 2;">
                                    <li><strong>Why would this bring MORE than Target Sales Price?</strong></li>
                                    <li><strong>Does it have a big clean book?</strong> (J.D. Power higher than MMR = upside potential)</li>
                                    <li><strong>Is it a demanded product?</strong> (4WD truck/SUV that will sell fast)</li>
                                </ol>
                            </div>
                            <p style="margin-top: 15px;">If you can't answer YES to at least one of these, <strong>don't stretch</strong>. Stick to your max bid.</p>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Decide on your max bid BEFORE the auction. Stick to it. If outbid, let it go. Losing a deal is better than losing money. There will always be another vehicle.
                        </div>
                    `
                },
                {
                    id: 'lesson-4-2',
                    title: 'Timing Your Bids',
                    content: `
                        <h2>Timing Your Bids</h2>

                        <div class="lesson-section">
                            <h3>Understanding Auction End Times</h3>
                            <p>OVE listings have specific end times. From the listings we reviewed:</p>
                            <ul>
                                <li>Most end in the evening (6 PM - 9 PM local time)</li>
                                <li>Auctions typically run for 24-72 hours</li>
                                <li>Some are weekend sales (Fri-Sun)</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Early Bird vs. Last Minute</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Strategy</th>
                                    <th>Pros</th>
                                    <th>Cons</th>
                                </tr>
                                <tr>
                                    <td><strong>Early Bid</strong></td>
                                    <td>Shows interest, may discourage others</td>
                                    <td>Reveals your intent, may drive up bids</td>
                                </tr>
                                <tr>
                                    <td><strong>Last Minute</strong></td>
                                    <td>Doesn't tip off other buyers</td>
                                    <td>Risk of missing the auction</td>
                                </tr>
                                <tr>
                                    <td><strong>Proxy Bid Early</strong></td>
                                    <td>Set it and forget it, won't miss it</td>
                                    <td>System may bid more than needed</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Best Practices</h3>
                            <ul>
                                <li>Research the vehicle early in the auction</li>
                                <li>Calculate your max bid before the last hour</li>
                                <li>If using proxy bid, enter it with enough time to spare</li>
                                <li>Watch the final minutes if possible</li>
                                <li>Don't chase - if outbid, let it go</li>
                            </ul>
                        </div>

                        <div class="warning-box">
                            <strong>Warning:</strong> Some auctions extend if there's bidding activity in the final minutes. Don't count on "sniping" to work.
                        </div>
                    `
                },
                {
                    id: 'lesson-4-3',
                    title: 'Avoiding Common Bidding Mistakes',
                    content: `
                        <h2>Avoiding Common Bidding Mistakes</h2>

                        <div class="lesson-section">
                            <h3>Mistake #1: Emotional Bidding</h3>
                            <p><strong>The Problem:</strong> You find a truck you love, get outbid, and keep raising your max.</p>
                            <p><strong>The Fix:</strong> Calculate your max bid beforehand. Write it down. Do not exceed it.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Mistake #2: Ignoring the Condition Report</h3>
                            <p><strong>The Problem:</strong> You see a great price, bid without reading the CR, win a problem vehicle.</p>
                            <p><strong>The Fix:</strong> Read EVERY condition report and seller comment before bidding.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Mistake #3: Not Factoring All Costs</h3>
                            <p><strong>The Problem:</strong> You win at a "great price" but forgot transport, fees, and recon.</p>
                            <p><strong>The Fix:</strong> Use the max bid formula every single time.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Mistake #4: Buying Too Far Away</h3>
                            <p><strong>The Problem:</strong> Vehicle is $1,000 under MMR but transport costs $1,200.</p>
                            <p><strong>The Fix:</strong> Factor transport into every deal. Sometimes local at market price beats distant "deals."</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Mistake #5: FOMO (Fear of Missing Out)</h3>
                            <p><strong>The Problem:</strong> You overpay because "this is the only one!"</p>
                            <p><strong>The Fix:</strong> There are thousands of vehicles on OVE daily. Another will come.</p>
                        </div>

                        <div class="key-point">
                            <strong>Golden Rule:</strong> Your profit is made when you BUY, not when you sell. A bad buy is nearly impossible to turn into a good sale.
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-4',
                title: 'Module 4 Quiz',
                questions: [
                    {
                        question: 'When should you consider using the "Buy Now" option?',
                        options: [
                            'Always - it\'s faster',
                            'When the Buy Now price fits within your calculated max bid (Book Value - $3,000 - Rehab)',
                            'When it\'s below MMR regardless of your formula',
                            'Only on vehicles over $50,000'
                        ],
                        correct: 1,
                        explanation: 'Only use Buy Now if the price fits within YOUR calculated max bid. The formula is: Book Value - $3,000 spread - Rehab costs. Don\'t buy just because it\'s below MMR.'
                    },
                    {
                        question: 'You calculated your max bid at $24,000. The current bid is $23,500 and someone outbids you at $24,200. What should you do?',
                        options: [
                            'Raise your bid to $24,500',
                            'Let it go - stick to your max bid',
                            'Bid $25,000 to make sure you win',
                            'Wait and see if they back out'
                        ],
                        correct: 1,
                        explanation: 'Stick to your max bid. If you calculated correctly, going over means cutting into profit or losing money.'
                    },
                    {
                        question: 'What is "proxy bidding"?',
                        options: [
                            'Having someone else bid for you',
                            'The system automatically bids up to your maximum',
                            'Bidding through a VPN',
                            'Bidding on multiple vehicles at once'
                        ],
                        correct: 1,
                        explanation: 'Proxy bidding means you set a maximum and the system bids incrementally on your behalf up to that amount.'
                    },
                    {
                        question: 'What is the biggest mistake new buyers make?',
                        options: [
                            'Bidding too early',
                            'Not bidding enough',
                            'Emotional bidding - exceeding their calculated max',
                            'Using Buy Now'
                        ],
                        correct: 2,
                        explanation: 'Emotional bidding leads to overpaying. Calculate your max bid first and never exceed it.'
                    },
                    {
                        question: 'A vehicle 1,000 miles away is $1,500 below MMR. Transport will cost $1,200. Is this a good deal?',
                        options: [
                            'Yes - you\'re still saving $300',
                            'No - after transport you\'re only $300 ahead, which doesn\'t account for risk',
                            'It depends on the color',
                            'Distance doesn\'t matter'
                        ],
                        correct: 1,
                        explanation: 'After transport, you\'re only $300 ahead. This tiny margin doesn\'t account for risk, time, or potential issues. A local vehicle at MMR might be a better choice.'
                    }
                ]
            }
        },
        {
            id: 'module-5',
            title: 'After the Purchase',
            lessons: [
                {
                    id: 'lesson-5-1',
                    title: 'Payment & Title Process',
                    content: `
                        <h2>Payment & Title Process</h2>

                        <div class="lesson-section">
                            <h3>Paying for Your Vehicle</h3>
                            <p>After winning, you typically have 24-48 hours to pay:</p>
                            <ul>
                                <li><strong>Wire Transfer:</strong> Most common, funds clear quickly</li>
                                <li><strong>Floorplan:</strong> If you have a line of credit (NextGear, AFC)</li>
                                <li><strong>ACH:</strong> Bank transfer, may take longer to clear</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Fees Breakdown</h3>
                            <ul>
                                <li><strong>Hammer Price:</strong> Your winning bid</li>
                                <li><strong>Buy Fee:</strong> Auction fee ($200-500)</li>
                                <li><strong>Title Fee:</strong> Processing fee</li>
                                <li><strong>PSI Fee:</strong> Post-sale inspection (if applicable)</li>
                                <li><strong>Storage:</strong> If vehicle not picked up promptly</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Getting the Title</h3>
                            <ol>
                                <li>Payment clears</li>
                                <li>Auction processes title (can take 3-14 days)</li>
                                <li>Title mailed or held at auction for pickup</li>
                                <li>If floorplanning, title goes to your lender</li>
                            </ol>
                        </div>

                        <div class="warning-box">
                            <strong>Important:</strong> You cannot legally sell a vehicle without the title. Factor title processing time into your planning.
                        </div>
                    `
                },
                {
                    id: 'lesson-5-2',
                    title: 'Arranging Transportation',
                    content: `
                        <h2>Arranging Transportation</h2>

                        <div class="lesson-section">
                            <h3>Transportation Options</h3>
                            <ul>
                                <li><strong>Auction transport service:</strong> Most auctions offer transport coordination</li>
                                <li><strong>Independent haulers:</strong> Often cheaper, shop around</li>
                                <li><strong>Drive it yourself:</strong> Cheapest but takes your time</li>
                                <li><strong>Ship with multiple vehicles:</strong> Per-unit cost drops</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Pickup Deadlines</h3>
                            <p>From actual OVE listings:</p>
                            <div class="data-example">
                                "Buyer must call at least 24 hours in advance and receive confirmation on availability of pickup time"<br><br>
                                "Pick up times: Mon-Thu: 7am-7pm, Fri: 7am-5pm"<br><br>
                                "After one week vehicle will be subject to $50 weekly storage fee"
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Tips for Smooth Transport</h3>
                            <ul>
                                <li>Arrange transport BEFORE you win</li>
                                <li>Confirm pickup hours with the auction</li>
                                <li>Get gate pass if required</li>
                                <li>Inspect upon delivery before signing</li>
                                <li>Take photos of any new damage</li>
                            </ul>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> Don't win a vehicle without a transport plan. Storage fees add up fast.
                        </div>
                    `
                },
                {
                    id: 'lesson-5-3',
                    title: 'Post-Sale Arbitration',
                    content: `
                        <h2>Post-Sale Arbitration</h2>

                        <div class="lesson-section">
                            <h3>What is Arbitration?</h3>
                            <p>Arbitration is your right to return or get compensation for a vehicle that was misrepresented.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Common Arbitration Claims</h3>
                            <ul>
                                <li><strong>Undisclosed frame damage</strong></li>
                                <li><strong>Odometer rollback</strong></li>
                                <li><strong>Undisclosed mechanical issues</strong></li>
                                <li><strong>Title problems (salvage, lien)</strong></li>
                                <li><strong>Significantly different from description</strong></li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Arbitration Limits</h3>
                            <p>Pay attention to seller comments like:</p>
                            <div class="data-example">
                                "LIMITED GUAR. NO ARB ON LEAKS"<br>
                                "AS-IS" - No arbitration allowed<br>
                                "GREEN LIGHT" - Full arbitration rights
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Arbitration Timeline</h3>
                            <ul>
                                <li>Usually must file within 24-72 hours of taking possession</li>
                                <li>Document everything with photos/video</li>
                                <li>Contact auction immediately</li>
                                <li>Keep vehicle available for inspection</li>
                            </ul>
                        </div>

                        <div class="warning-box">
                            <strong>Important:</strong> "As-Is" and "No Arbitration" vehicles are higher risk. As a beginner, prefer vehicles with full arbitration rights.
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-5',
                title: 'Module 5 Quiz',
                questions: [
                    {
                        question: 'How long do you typically have to pay for a vehicle after winning?',
                        options: [
                            '1 hour',
                            '24-48 hours',
                            '1 week',
                            '30 days'
                        ],
                        correct: 1,
                        explanation: 'Most auctions require payment within 24-48 hours of winning.'
                    },
                    {
                        question: 'What happens if you don\'t pick up your vehicle promptly?',
                        options: [
                            'Nothing - free storage forever',
                            'Storage fees start accumulating (often $50/week)',
                            'The sale is cancelled',
                            'The auction keeps the vehicle'
                        ],
                        correct: 1,
                        explanation: 'Auctions charge storage fees, often around $50/week after the initial pickup period.'
                    },
                    {
                        question: 'What does "NO ARB ON LEAKS" mean?',
                        options: [
                            'The vehicle has no leaks',
                            'You cannot return the vehicle for leak issues',
                            'Leaks have been repaired',
                            'The seller will fix leaks'
                        ],
                        correct: 1,
                        explanation: 'This means you cannot file an arbitration claim if the vehicle has leaks - you accept that risk.'
                    },
                    {
                        question: 'When should you arrange transportation?',
                        options: [
                            'After you win',
                            'When the title arrives',
                            'Before you bid/win',
                            'Whenever convenient'
                        ],
                        correct: 2,
                        explanation: 'Arrange transport before bidding so you can factor in costs and avoid delays after winning.'
                    },
                    {
                        question: 'What should you do upon vehicle delivery?',
                        options: [
                            'Sign and send the driver on their way',
                            'Inspect for new damage and photograph before signing',
                            'Inspection isn\'t necessary',
                            'Only check the VIN'
                        ],
                        correct: 1,
                        explanation: 'Always inspect the vehicle upon delivery and document any new damage before signing the delivery receipt.'
                    }
                ]
            }
        },
        {
            id: 'module-6',
            title: 'Real Deal Case Study',
            lessons: [
                {
                    id: 'lesson-6-1',
                    title: 'Case Study: 2014 Ram 1500 Longhorn Limited',
                    content: `
                        <h2>Case Study: 2014 Ram 1500 Longhorn Limited</h2>

                        <div class="case-study-header">
                            <p>Let's walk through a real purchase from OVE and analyze every aspect of the deal.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>The Vehicle</h3>
                            <div class="data-example">
                                <strong>2014 Ram 1500 Laramie Longhorn Limited</strong><br>
                                Crew Cab 4WD | 5.7L V8 HEMI<br><br>

                                <strong>VIN:</strong> 1C6RR7PT6ES367851<br>
                                <strong>Mileage:</strong> 67,761<br>
                                <strong>Exterior:</strong> Black<br>
                                <strong>Interior:</strong> Black Leather<br>
                                <strong>MSRP When New:</strong> $49,580
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>OVE Listing Details</h3>
                            <div class="data-example">
                                <strong>CR Grade:</strong> 2.8 (Rough)<br>
                                <strong>Seller:</strong> First CDJR Corp<br>
                                <strong>Pickup:</strong> CA - Canoga Park (Manheim Southern California)<br>
                                <strong>Sale Type:</strong> Timed Sale (Manheim Express)<br>
                                <strong>Status:</strong> SOLD
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Condition Report Highlights</h3>
                            <ul>
                                <li><strong>Exterior Issues:</strong> 13 total (dents, scratches, paint damage on bumpers, hood, doors, bed)</li>
                                <li><strong>Interior:</strong> No damage - clean</li>
                                <li><strong>Mechanical:</strong> 2 diagnostic codes (Engine Coolant Bypass Valve)</li>
                                <li><strong>Active Leaks:</strong> Yes - from engine/undercarriage</li>
                                <li><strong>Tires:</strong> Good (6/32" or above), but wheel cosmetic damage on 3 wheels</li>
                                <li><strong>Starts/Drives:</strong> Yes</li>
                                <li><strong>Open Recall:</strong> Yes (noted)</li>
                            </ul>
                        </div>

                        <div class="warning-box">
                            <strong>Note:</strong> CR Grade 2.8 is in the "Rough" category. This vehicle has issues that need attention - not a beginner-friendly purchase without proper evaluation.
                        </div>
                    `
                },
                {
                    id: 'lesson-6-2',
                    title: 'Analyzing the Book Values',
                    content: `
                        <h2>Analyzing the Book Values</h2>

                        <div class="lesson-section">
                            <h3>Autoniq Report Values</h3>
                            <p>Here's what Autoniq showed for this vehicle:</p>

                            <table class="data-table">
                                <tr>
                                    <th>Source</th>
                                    <th>XClean</th>
                                    <th>Clean</th>
                                    <th>Avg</th>
                                    <th>Rough</th>
                                </tr>
                                <tr>
                                    <td><strong>Black Book (Wholesale)</strong></td>
                                    <td>$19,050</td>
                                    <td>$17,050</td>
                                    <td>$14,150</td>
                                    <td>$11,475</td>
                                </tr>
                                <tr>
                                    <td><strong>J.D. Power (Trade-In)</strong></td>
                                    <td>-</td>
                                    <td>$27,750</td>
                                    <td>$26,450</td>
                                    <td>$24,850</td>
                                </tr>
                            </table>

                            <div class="data-example" style="margin-top: 20px;">
                                <strong>MMR (Manheim Market Report):</strong><br>
                                Base MMR: $11,850<br>
                                Adjusted MMR (67k miles, Grade 4.0, Black): <strong>$21,400</strong><br><br>

                                <strong>Retail Index:</strong><br>
                                Avg Retail Price: $16,621 (based on 3 local listings)<br>
                                Avg Days on Lot: 86 days
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Key Observations</h3>
                            <ul>
                                <li>J.D. Power values are much higher than Black Book - J.D. Power is trade-in (retail side)</li>
                                <li>Black Book "Rough" at $11,475 reflects the 2.8 CR grade</li>
                                <li>MMR Adjusted assumes Grade 4.0 - but this truck is Grade 2.8</li>
                                <li>Retail Index shows $16,621 avg - but those have higher miles (116k avg vs 67k)</li>
                            </ul>
                        </div>

                        <div class="key-point">
                            <strong>Reality Check:</strong> With a 2.8 CR grade and issues noted, you should use the "Rough" or "Avg" values, not "Clean" or "XClean".
                        </div>
                    `
                },
                {
                    id: 'lesson-6-3',
                    title: 'Calculating the Deal',
                    content: `
                        <h2>Calculating the Deal</h2>

                        <div class="lesson-section">
                            <h3>The Purchase</h3>
                            <div class="calculation-example">
                                <strong>Purchase Price:</strong> $16,700
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Estimating Target Sales Price</h3>
                            <p>Given the low miles (67k) but rough condition (2.8 CR), let's be conservative:</p>
                            <div class="data-example">
                                Black Book Avg: $14,150<br>
                                Retail Index: $16,621<br>
                                MMR Adjusted: $21,400 (but this assumes better condition)<br><br>

                                <strong>Realistic Target Sales Price: ~$18,000-20,000</strong><br>
                                <em>(Lower miles help, but condition hurts)</em>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Estimating Rehab Costs</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Issue</th>
                                    <th>Estimated Cost</th>
                                </tr>
                                <tr>
                                    <td>13 exterior issues (dents, scratches, paint)</td>
                                    <td>$800-1,500</td>
                                </tr>
                                <tr>
                                    <td>2 diagnostic codes (coolant bypass valve)</td>
                                    <td>$400-600</td>
                                </tr>
                                <tr>
                                    <td>Active leaks</td>
                                    <td>$200-500</td>
                                </tr>
                                <tr>
                                    <td>Wheel cosmetic damage (3 wheels)</td>
                                    <td>$150-300</td>
                                </tr>
                                <tr>
                                    <td>Detail</td>
                                    <td>$200-300</td>
                                </tr>
                                <tr class="total-row">
                                    <td><strong>TOTAL REHAB ESTIMATE</strong></td>
                                    <td><strong>$1,750-3,200</strong></td>
                                </tr>
                            </table>
                            <p>Let's use <strong>$2,500</strong> as a realistic middle estimate.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Running the Formula</h3>
                            <div class="calculation-example">
                                <strong>Using Target Sales Price of $19,000:</strong><br><br>

                                Target Sales Price: $19,000<br>
                                - $3,000 (minimum spread)<br>
                                - $2,500 (rehab estimate)<br>
                                ───────────────────<br>
                                <strong>Maximum Bid Should Be: $13,500</strong><br><br>

                                <strong>Actual Purchase Price: $16,700</strong><br><br>

                                <span style="color: #e74c3c;"><strong>OVER MAX BID BY: $3,200</strong></span>
                            </div>
                        </div>

                        <div class="warning-box" style="background: #4a1515; border-color: #e94560;">
                            <h3 style="color: #e94560;">THIS IS AN EXAMPLE OF WHAT NOT TO DO</h3>
                            <p>This deal violated our formula. The buyer paid $16,700 when the max bid should have been $13,500. Here's why we're showing you this:</p>
                            <ul>
                                <li><strong>Learn from mistakes:</strong> This happens when buyers skip the formula</li>
                                <li><strong>Emotion killed the deal:</strong> The Longhorn Limited trim and low miles made it "feel" worth more</li>
                                <li><strong>The formula exists for a reason:</strong> Breaking it means gambling with your profit</li>
                            </ul>
                        </div>
                    `
                },
                {
                    id: 'lesson-6-4',
                    title: 'Lessons Learned',
                    content: `
                        <h2>Lessons Learned: Why This Deal Was a Mistake</h2>

                        <div class="warning-box" style="background: #4a1515;">
                            <h3 style="color: #e94560;">THE VERDICT: SHOULD NOT HAVE BOUGHT IT</h3>
                            <p>This truck was purchased for $3,200 over the calculated max bid. Let's learn from this mistake.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>What Made It Tempting (The Traps)</h3>
                            <ul class="green-flags">
                                <li><strong>Low mileage:</strong> 67,761 is excellent for a 2014 - made it seem like a "unicorn"</li>
                                <li><strong>Desirable trim:</strong> Longhorn Limited sounds fancy and expensive</li>
                                <li><strong>Clean history:</strong> No accidents felt reassuring</li>
                                <li><strong>"Below MMR":</strong> $16,700 vs $21,400 MMR seemed like a steal</li>
                            </ul>
                            <p style="margin-top: 15px; color: #facc15;"><strong>But none of these change the math!</strong></p>
                        </div>

                        <div class="lesson-section">
                            <h3>What Actually Matters (The Reality)</h3>
                            <ul class="red-flags">
                                <li><strong>CR Grade 2.8:</strong> "Rough" means ~$1,500-2,000 in rehab needed</li>
                                <li><strong>13 exterior issues:</strong> That's a LOT of body work</li>
                                <li><strong>Active leaks:</strong> Unknown repair cost - could spiral</li>
                                <li><strong>California shipping:</strong> $1,200-1,600 just in transport</li>
                                <li><strong>Older vehicle:</strong> 2014 = harder to retail at premium price</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>How This Deal Likely Ended</h3>
                            <div class="calculation-example" style="background: #3a1515;">
                                <strong>Scenario: Reality Check</strong><br><br>
                                Purchase: $16,700<br>
                                Actual Rehab (likely): $3,000+<br>
                                Shipping from CA: $1,400<br>
                                <strong>Total Investment: $21,100+</strong><br><br>

                                Realistic Sale Price: $19,000-20,000<br>
                                <span style="color: #e94560;"><strong>RESULT: BREAK EVEN OR LOSS</strong></span>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>The Real Lesson</h3>
                            <ol>
                                <li><strong>ALWAYS run the formula BEFORE bidding</strong> - never after</li>
                                <li><strong>Don't fall for "low miles" or "nice trim"</strong> - the math is the math</li>
                                <li><strong>MMR doesn't matter if your formula doesn't work</strong></li>
                                <li><strong>Shipping distance kills margins</strong> - factor it BEFORE you bid</li>
                                <li><strong>If you can't hit your max bid, WALK AWAY</strong></li>
                            </ol>
                        </div>

                        <div class="key-point" style="background: #1a3a1a;">
                            <h3 style="color: #4ade80;">THE GOLDEN RULE</h3>
                            <p style="font-size: 1.2em;">Your max bid is your max bid. No trim level, no mileage, no "feeling" should make you exceed it. <strong>There will ALWAYS be another truck.</strong></p>
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-6',
                title: 'Case Study Quiz',
                questions: [
                    {
                        question: 'What was the CR Grade on the 2014 Ram 1500 Longhorn?',
                        options: [
                            '4.0 - Clean',
                            '3.5 - Average',
                            '2.8 - Rough',
                            '2.0 - Damaged'
                        ],
                        correct: 2,
                        explanation: 'The Ram had a CR Grade of 2.8, which falls in the "Rough" category indicating significant issues.'
                    },
                    {
                        question: 'How many exterior issues were noted on the condition report?',
                        options: [
                            '3',
                            '7',
                            '13',
                            '20'
                        ],
                        correct: 2,
                        explanation: 'The condition report noted 13 exterior issues including dents, scratches, and paint damage.'
                    },
                    {
                        question: 'What mechanical codes were found on this vehicle?',
                        options: [
                            'Transmission codes',
                            'Engine coolant bypass valve codes',
                            'ABS codes',
                            'No codes'
                        ],
                        correct: 1,
                        explanation: 'Two diagnostic codes were found related to the Engine Coolant Bypass Valve (P2681 and P26AB).'
                    },
                    {
                        question: 'Using the Carz Inc formula with Target Sales Price of $19,000 and $2,500 rehab, what should the max bid be?',
                        options: [
                            '$16,000',
                            '$14,500',
                            '$13,500',
                            '$15,500'
                        ],
                        correct: 2,
                        explanation: '$19,000 - $3,000 (spread) - $2,500 (rehab) = $13,500 maximum bid'
                    },
                    {
                        question: 'What was the actual purchase price of the Ram?',
                        options: [
                            '$13,500',
                            '$16,700',
                            '$19,000',
                            '$21,400'
                        ],
                        correct: 1,
                        explanation: 'The vehicle was purchased for $16,700.'
                    },
                    {
                        question: 'What positive factor helped offset the rough condition on this truck?',
                        options: [
                            'It was local pickup',
                            'Low mileage (67,761) for a 2014',
                            'No rehab needed',
                            'High CR grade'
                        ],
                        correct: 1,
                        explanation: 'The low mileage of 67,761 is excellent for a 2014 model year (average would be 100k+), which helps maintain value despite the rough condition.'
                    }
                ]
            }
        },
        {
            id: 'module-7',
            title: 'Vehicle History Reports',
            lessons: [
                {
                    id: 'lesson-7-1',
                    title: 'Carfax vs AutoCheck',
                    content: `
                        <h2>Carfax vs AutoCheck: Understanding Vehicle History Reports</h2>

                        <div class="lesson-section">
                            <h3>Why History Reports Matter</h3>
                            <p>Vehicle history reports reveal hidden problems that the condition report doesn't show. Issues on these reports <strong>directly affect how much you can sell the car for</strong> - sometimes by thousands of dollars.</p>

                            <div class="warning-box">
                                <strong>Rule:</strong> ALWAYS pull a history report before bidding on any vehicle. A $40 report can save you from a $5,000 mistake.
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Carfax vs AutoCheck</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Feature</th>
                                    <th>Carfax</th>
                                    <th>AutoCheck</th>
                                </tr>
                                <tr>
                                    <td>Data Sources</td>
                                    <td>100,000+ sources</td>
                                    <td>Experian-based</td>
                                </tr>
                                <tr>
                                    <td>Accident Reporting</td>
                                    <td>More detailed categories</td>
                                    <td>Good but less granular</td>
                                </tr>
                                <tr>
                                    <td>Service Records</td>
                                    <td>Stronger dealer network</td>
                                    <td>Good but fewer shops report</td>
                                </tr>
                                <tr>
                                    <td>Score System</td>
                                    <td>No score</td>
                                    <td>AutoCheck Score (1-100)</td>
                                </tr>
                                <tr>
                                    <td>Cost</td>
                                    <td>~$40 single / bulk packages</td>
                                    <td>Usually cheaper / included in OVE</td>
                                </tr>
                            </table>

                            <div class="key-point">
                                <strong>Best Practice:</strong> Pull BOTH when possible. Each catches things the other misses. OVE often includes one - pull the other yourself.
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>What History Reports Show</h3>
                            <ul>
                                <li><strong>Title History:</strong> Clean, Salvage, Rebuilt, Lemon, Flood</li>
                                <li><strong>Accident Reports:</strong> Minor, Moderate, Severe + where damage occurred</li>
                                <li><strong>Airbag Deployment:</strong> Major safety event</li>
                                <li><strong>Structural/Frame Damage:</strong> Deal killer</li>
                                <li><strong>Flood/Water Damage:</strong> Avoid completely</li>
                                <li><strong>Odometer Issues:</strong> Rollback, discrepancy, "exempt"</li>
                                <li><strong>Number of Owners:</strong> More owners = more concern</li>
                                <li><strong>Service History:</strong> Regular maintenance is good</li>
                                <li><strong>Previous Use:</strong> Personal, fleet, rental, lease</li>
                            </ul>
                        </div>
                    `
                },
                {
                    id: 'lesson-7-2',
                    title: 'Accidents: Minor vs Moderate vs Severe',
                    content: `
                        <h2>Understanding Accident Reports</h2>

                        <div class="lesson-section">
                            <h3>How Accidents Are Categorized</h3>
                            <p>Carfax and AutoCheck categorize accidents by severity and damage location. Here's how each level affects resale value:</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Minor Accident / Minor Damage</h3>
                            <div class="data-example">
                                <strong>What It Means:</strong> Fender bender, parking lot scrape, minor rear-end<br>
                                <strong>Typical Repairs:</strong> Bumper replacement, light panel work, under $3,000 in repairs<br><br>
                                <strong>Impact on Value: 5-10% reduction</strong>
                            </div>
                            <ul>
                                <li>Most buyers can live with a minor accident on older vehicles</li>
                                <li>On newer/premium vehicles, buyers are pickier</li>
                                <li>Still sellable at retail but expect lower offers</li>
                                <li><strong>Factor: Deduct $500-1,500 from expected sales price</strong></li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Moderate Accident / Moderate Damage</h3>
                            <div class="data-example">
                                <strong>What It Means:</strong> Significant collision, multiple panels, $3,000-$10,000 repairs<br>
                                <strong>Typical Repairs:</strong> Multiple body panels, possible suspension, structural concerns<br><br>
                                <strong>Impact on Value: 15-25% reduction</strong>
                            </div>
                            <ul>
                                <li>Many retail buyers will pass on these</li>
                                <li>Need to disclose and price accordingly</li>
                                <li>Check for hidden mechanical damage</li>
                                <li><strong>Factor: Deduct $2,000-4,000 from expected sales price</strong></li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Severe Accident</h3>
                            <div class="data-example">
                                <strong>What It Means:</strong> Major collision, $10,000+ repairs, potential total loss that was rebuilt<br>
                                <strong>Typical Repairs:</strong> Frame work, multiple systems, major structural repair<br><br>
                                <strong>Impact on Value: 30-50%+ reduction</strong>
                            </div>
                            <ul class="red-flags">
                                <li>Very hard to retail - mostly wholesale/export buyers</li>
                                <li>Will likely show frame damage on report</li>
                                <li>Airbags may have deployed</li>
                                <li><strong>AVOID as a beginner - these are expert-only deals</strong></li>
                            </ul>
                        </div>

                        <div class="warning-box">
                            <strong>Location Matters:</strong>
                            <ul>
                                <li>Front accident = engine/transmission risk</li>
                                <li>Side accident = frame/structural risk</li>
                                <li>Rear accident = trunk/electrical issues</li>
                            </ul>
                        </div>
                    `
                },
                {
                    id: 'lesson-7-3',
                    title: 'Deal Killers: Frame, Flood, Airbags',
                    content: `
                        <h2>Deal Killers: Issues That Destroy Value</h2>

                        <div class="lesson-section">
                            <h3>Frame / Structural Damage</h3>
                            <div class="warning-box" style="background: #4a1515;">
                                <strong>AVOID - DEAL KILLER</strong>
                            </div>
                            <ul>
                                <li><strong>What It Means:</strong> The structural frame of the vehicle was damaged and repaired</li>
                                <li><strong>Why It's Bad:</strong> Frame damage affects safety, alignment, and is impossible to fully restore</li>
                                <li><strong>Impact:</strong> 40-60% value reduction, many states require disclosure</li>
                                <li><strong>Our Rule:</strong> <strong>DO NOT BUY</strong> frame damage vehicles. Period.</li>
                            </ul>
                            <p>Even "repaired" frame damage creates liability and is nearly impossible to retail. Pass every time.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Flood / Water Damage</h3>
                            <div class="warning-box" style="background: #4a1515;">
                                <strong>AVOID - DEAL KILLER</strong>
                            </div>
                            <ul>
                                <li><strong>What It Means:</strong> Vehicle was submerged in water (hurricane, flash flood)</li>
                                <li><strong>Why It's Bad:</strong> Electrical systems corrode from inside out, problems appear months later</li>
                                <li><strong>Impact:</strong> Should be titled "Flood" - worth 60-80% less than clean title</li>
                                <li><strong>Our Rule:</strong> <strong>NEVER BUY</strong> flood vehicles. Ever.</li>
                            </ul>
                            <p>Flood cars are time bombs. Corrosion destroys wiring, computers, and safety systems. No amount of discount is worth it.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Airbag Deployment</h3>
                            <div class="warning-box" style="background: #6b4400;">
                                <strong>MAJOR RED FLAG - USUALLY AVOID</strong>
                            </div>
                            <ul>
                                <li><strong>What It Means:</strong> Vehicle was in accident severe enough to deploy airbags</li>
                                <li><strong>Why It's Bad:</strong> Indicates significant impact, airbag replacement costs $2,000-5,000</li>
                                <li><strong>Impact:</strong> 25-40% value reduction</li>
                                <li><strong>Associated Issues:</strong> Often comes with frame damage, severe accident history</li>
                            </ul>
                            <div class="key-point">
                                <strong>If buying an airbag deployment vehicle:</strong>
                                <ul>
                                    <li>Verify airbags were PROPERLY replaced (not just covered)</li>
                                    <li>Check for frame damage (almost always present)</li>
                                    <li>Deduct $3,000-5,000 from your max bid</li>
                                    <li>Only buy if steep discount makes sense</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Title Brands to Avoid</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Title Brand</th>
                                    <th>Meaning</th>
                                    <th>Value Impact</th>
                                </tr>
                                <tr style="background: #4a1515;">
                                    <td>Flood</td>
                                    <td>Water damage</td>
                                    <td>-60% to -80%</td>
                                </tr>
                                <tr style="background: #4a1515;">
                                    <td>Salvage</td>
                                    <td>Totaled, not roadworthy</td>
                                    <td>Cannot retail</td>
                                </tr>
                                <tr style="background: #6b4400;">
                                    <td>Rebuilt</td>
                                    <td>Was salvage, now repaired</td>
                                    <td>-30% to -50%</td>
                                </tr>
                                <tr style="background: #6b4400;">
                                    <td>Lemon</td>
                                    <td>Manufacturer buyback for defects</td>
                                    <td>-15% to -30%</td>
                                </tr>
                                <tr>
                                    <td>Rental/Fleet</td>
                                    <td>Previous commercial use</td>
                                    <td>-5% to -10%</td>
                                </tr>
                            </table>
                        </div>
                    `
                },
                {
                    id: 'lesson-7-4',
                    title: 'Hail Damage & How It Affects Value',
                    content: `
                        <h2>Hail Damage: A Special Case</h2>

                        <div class="lesson-section">
                            <h3>Why Hail Is Different</h3>
                            <p>Unlike accidents, hail damage is purely cosmetic - it doesn't affect the mechanical operation or safety of the vehicle. This creates opportunity.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Hail Damage on History Report</h3>
                            <ul>
                                <li><strong>"Previous Hail Damage"</strong> - Vehicle had hail damage reported to insurance</li>
                                <li><strong>"Hail damage claim"</strong> - Claim filed, may or may not have been repaired</li>
                                <li>This stays on the report FOREVER even if repaired</li>
                            </ul>

                            <div class="key-point">
                                <strong>Value Impact:</strong> 10-25% reduction even if repaired, because report shows history
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Hail Damage in Current Condition</h3>
                            <p>When evaluating CURRENT hail damage (from CR and photos):</p>
                            <table class="data-table">
                                <tr>
                                    <th>Severity</th>
                                    <th>Description</th>
                                    <th>Repair Cost</th>
                                </tr>
                                <tr>
                                    <td>Light</td>
                                    <td>Few small dents, barely visible</td>
                                    <td>$400-800 PDR</td>
                                </tr>
                                <tr>
                                    <td>Moderate</td>
                                    <td>Multiple panels, visible dents</td>
                                    <td>$400-500 per panel</td>
                                </tr>
                                <tr>
                                    <td>Severe</td>
                                    <td>Every panel hit, possible paint damage</td>
                                    <td>$3,000-8,000+</td>
                                </tr>
                            </table>
                        </div>

                        <div class="warning-box">
                            <strong>IMPORTANT - Photo Rule:</strong><br>
                            If you can see hail damage in photos (look at the reflections on body panels), it's probably MUCH WORSE in person. Photos hide 50%+ of hail damage.
                        </div>

                        <div class="lesson-section">
                            <h3>Selling Hail Damaged Vehicles</h3>
                            <ul>
                                <li><strong>Option 1: Repair and retail</strong> - Fix it, disclose the history, sell at slight discount</li>
                                <li><strong>Option 2: Sell as-is with disclosure</strong> - Price 15-25% below market, target budget buyers</li>
                                <li><strong>Option 3: Wholesale it</strong> - If repair cost exceeds value recovered</li>
                            </ul>

                            <div class="key-point">
                                <strong>Our Strategy:</strong> Hail cars can be profitable if bought cheap enough. Budget $400-500 per panel for PDR, and buy at 20%+ below market.
                            </div>
                        </div>
                    `
                },
                {
                    id: 'lesson-7-5',
                    title: 'Max Bid Examples with History Issues',
                    content: `
                        <h2>5 Max Bid Examples: How History Affects Your Numbers</h2>

                        <div class="lesson-section">
                            <h3>The Formula (Review)</h3>
                            <div class="calculation-example" style="background: #1a3a1a;">
                                <strong>Max Bid = Average Book Value - $3,000 (spread) - Rehab Costs - History Discount</strong><br><br>
                                If a vehicle is "ready to go" with clean history: Max Bid = Book Value - $3,000<br>
                                If it needs work: Deduct rehab from there
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example 1: Clean History, Needs Rehab</h3>
                            <div class="calculation-example">
                                <strong>2019 Chevrolet Silverado LT Z71</strong><br>
                                Autoniq Average: $29,000<br>
                                History: Clean - no accidents<br>
                                CR Grade: 2.4<br>
                                Issues: Needs tires ($800), body work 2 panels ($700), detail ($200)<br>
                                Rehab Total: $1,700<br><br>

                                Calculation:<br>
                                $29,000 (book) - $3,000 (spread) - $1,700 (rehab) = <strong>$24,300 Max Bid</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example 2: Minor Accident History</h3>
                            <div class="calculation-example">
                                <strong>2020 Ford F-150 XLT</strong><br>
                                Autoniq Average: $32,000<br>
                                History: Minor rear accident (repaired)<br>
                                CR Grade: 3.2<br>
                                Issues: Minor cosmetic only ($400)<br><br>

                                Calculation:<br>
                                $32,000 (book) - $1,500 (history discount) = $30,500 adjusted value<br>
                                $30,500 - $3,000 (spread) - $400 (rehab) = <strong>$27,100 Max Bid</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example 3: Moderate Accident + Rehab</h3>
                            <div class="calculation-example">
                                <strong>2018 GMC Sierra 1500 SLT</strong><br>
                                Autoniq Average: $28,000<br>
                                History: Moderate front accident (repaired, no frame)<br>
                                CR Grade: 2.6<br>
                                Issues: Engine light ($600), body work ($800), tires ($600)<br>
                                Rehab Total: $2,000<br><br>

                                Calculation:<br>
                                $28,000 (book) - $3,000 (history discount) = $25,000 adjusted value<br>
                                $25,000 - $3,000 (spread) - $2,000 (rehab) = <strong>$20,000 Max Bid</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example 4: Previous Hail (Repaired)</h3>
                            <div class="calculation-example">
                                <strong>2021 Ram 1500 Big Horn</strong><br>
                                Autoniq Average: $35,000<br>
                                History: Previous hail damage claim (already repaired)<br>
                                CR Grade: 3.8<br>
                                Issues: Ready to go, no current damage<br><br>

                                Calculation:<br>
                                $35,000 (book) - $2,000 (hail history discount) = $33,000 adjusted value<br>
                                $33,000 - $3,000 (spread) - $0 (rehab) = <strong>$30,000 Max Bid</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example 5: Current Hail Damage (Unrepaired)</h3>
                            <div class="calculation-example">
                                <strong>2019 Toyota Tundra SR5</strong><br>
                                Autoniq Average: $31,000<br>
                                History: Clean before this<br>
                                CR Grade: 2.2<br>
                                Issues: Current moderate hail (6 panels @ $450 each = $2,700)<br><br>

                                Calculation (if we repair):<br>
                                $31,000 (book) - $2,000 (will show hail history after claim) = $29,000<br>
                                $29,000 - $3,000 (spread) - $2,700 (rehab) = <strong>$23,300 Max Bid</strong><br><br>

                                Calculation (if sold as-is with hail):<br>
                                $31,000 - 20% (hail discount to buyer) = $24,800 sales price<br>
                                $24,800 - $3,000 (spread) = <strong>$21,800 Max Bid</strong>
                            </div>
                        </div>

                        <div class="key-point">
                            <strong>Key Takeaway:</strong> History issues compound with rehab costs. A "cheap" car with a moderate accident AND $2,500 in rehab might have $5,500 in deductions before you even factor your profit margin.
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-7',
                title: 'History Reports Quiz',
                questions: [
                    {
                        question: 'What is the value impact of frame/structural damage?',
                        options: [
                            '5-10% reduction',
                            '15-25% reduction',
                            '40-60% reduction - DO NOT BUY',
                            'No impact if repaired'
                        ],
                        correct: 2,
                        explanation: 'Frame damage reduces value by 40-60% and should be avoided completely. These vehicles are nearly impossible to retail.'
                    },
                    {
                        question: 'A vehicle shows "Minor Accident" on Carfax. How much should you deduct from expected sales price?',
                        options: [
                            'Nothing - minor doesn\'t matter',
                            '$500-1,500',
                            '$5,000+',
                            'Just walk away'
                        ],
                        correct: 1,
                        explanation: 'Minor accidents typically reduce value by 5-10%, or roughly $500-1,500 on typical trucks.'
                    },
                    {
                        question: 'You can see hail damage in the listing photos. What should you assume?',
                        options: [
                            'The photos show the full extent',
                            'It\'s probably much worse in person',
                            'Hail doesn\'t affect value',
                            'The seller already fixed it'
                        ],
                        correct: 1,
                        explanation: 'If you can see hail in photos, it\'s probably much worse in person. Photos hide 50%+ of hail damage.'
                    },
                    {
                        question: 'Which title brand is the absolute worst to buy?',
                        options: [
                            'Lemon',
                            'Rebuilt',
                            'Flood',
                            'Rental'
                        ],
                        correct: 2,
                        explanation: 'Flood is the worst - water corrodes electrical systems from the inside and problems appear months later. NEVER buy flood vehicles.'
                    },
                    {
                        question: 'A clean vehicle has Autoniq average of $25,000 and needs $2,000 rehab. What is the max bid?',
                        options: [
                            '$22,000',
                            '$20,000',
                            '$23,000',
                            '$19,000'
                        ],
                        correct: 1,
                        explanation: '$25,000 - $3,000 (spread) - $2,000 (rehab) = $20,000 max bid.'
                    },
                    {
                        question: 'Airbag deployment typically indicates:',
                        options: [
                            'A minor fender bender',
                            'A significant impact, often with frame damage',
                            'Normal wear and tear',
                            'Electrical issues only'
                        ],
                        correct: 1,
                        explanation: 'Airbag deployment means a severe enough impact to trigger safety systems. This almost always means significant accident history and often frame damage.'
                    }
                ]
            }
        },
        {
            id: 'module-8',
            title: 'Learn from Real Deals',
            lessons: [
                {
                    id: 'lesson-8-1',
                    title: 'Our Target Numbers',
                    content: `
                        <h2>Carz Inc Target Numbers</h2>

                        <div class="lesson-section">
                            <h3>The Golden Rules</h3>
                            <div class="key-point" style="background: #1a3a1a; padding: 20px; border-left: 4px solid #4ade80;">
                                <h3 style="color: #4ade80; margin-top: 0;">Target Spread: $3,000 Minimum</h3>
                                <ul>
                                    <li>$2,000 covers fees (office, shipping, lot, auction, floor plan)</li>
                                    <li>$1,000 is your target profit per vehicle</li>
                                </ul>
                            </div>

                            <div class="key-point" style="background: #2a2a1a; padding: 20px; border-left: 4px solid #facc15; margin-top: 15px;">
                                <h3 style="color: #facc15; margin-top: 0;">Target Rehab: Under $3,000</h3>
                                <ul>
                                    <li>Vehicles needing more than $3,000 in rehab are higher risk</li>
                                    <li>Rehab costs are ADDITIONAL to the $3,000 spread</li>
                                    <li>Total (spread + rehab) should ideally stay under $6,000</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>The Max Bid Formula</h3>
                            <div class="calculation-example">
                                <strong style="font-size: 1.2em;">Max Bid = Average Book Value - $3,000 - Rehab Costs</strong><br><br>

                                <table class="data-table">
                                    <tr>
                                        <th>Scenario</th>
                                        <th>Book Value</th>
                                        <th>Rehab</th>
                                        <th>Max Bid</th>
                                    </tr>
                                    <tr>
                                        <td>Ready to go</td>
                                        <td>$25,000</td>
                                        <td>$0</td>
                                        <td>$22,000</td>
                                    </tr>
                                    <tr>
                                        <td>Light rehab</td>
                                        <td>$25,000</td>
                                        <td>$1,500</td>
                                        <td>$20,500</td>
                                    </tr>
                                    <tr>
                                        <td>Moderate rehab</td>
                                        <td>$25,000</td>
                                        <td>$2,500</td>
                                        <td>$19,500</td>
                                    </tr>
                                    <tr>
                                        <td>Heavy rehab</td>
                                        <td>$25,000</td>
                                        <td>$4,000</td>
                                        <td>$18,000</td>
                                    </tr>
                                </table>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Why $3,000 Rehab Target?</h3>
                            <p>Based on our historical data:</p>
                            <ul>
                                <li>Vehicles with rehab under $3,000 average <strong>higher profit margins</strong></li>
                                <li>Vehicles over $3,000 rehab have more surprises and cost overruns</li>
                                <li>Our shop handles most issues well, but there's always risk</li>
                                <li>Lower rehab = faster turnaround = less floor plan cost</li>
                            </ul>
                        </div>

                        <div class="warning-box">
                            <strong>Remember:</strong> Your profit is made when you BUY. If the numbers don't work at purchase, no amount of work makes it profitable.
                        </div>
                    `
                },
                {
                    id: 'lesson-8-2',
                    title: 'Historical Data: What the Numbers Show',
                    content: `
                        <h2>Learning from 3,627 Real Deals</h2>

                        <div class="lesson-section">
                            <h3>Our Overall Performance</h3>
                            <div class="data-example">
                                <table class="data-table">
                                    <tr>
                                        <th>Metric</th>
                                        <th>Average</th>
                                    </tr>
                                    <tr>
                                        <td>Profit per Vehicle</td>
                                        <td><strong>$1,148</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Rehab Cost per Vehicle</td>
                                        <td><strong>$3,495</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Days on Lot</td>
                                        <td><strong>35 days</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Average Sales Price</td>
                                        <td><strong>$24,366</strong></td>
                                    </tr>
                                    <tr>
                                        <td>Average Total Cost</td>
                                        <td><strong>$19,723</strong></td>
                                    </tr>
                                </table>
                            </div>
                            <p>Notice: Our average rehab ($3,495) is slightly over our $3,000 target - that's why we're emphasizing this rule!</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Profit by Rehab Range</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Rehab Range</th>
                                    <th>Vehicle Count</th>
                                    <th>Avg Profit</th>
                                </tr>
                                <tr style="background: #1a3a1a;">
                                    <td>$0 - $1,000</td>
                                    <td>1,140 vehicles</td>
                                    <td><strong>$1,247</strong></td>
                                </tr>
                                <tr style="background: #1a3a1a;">
                                    <td>$1,000 - $2,000</td>
                                    <td>548 vehicles</td>
                                    <td><strong>$1,194</strong></td>
                                </tr>
                                <tr style="background: #2a2a1a;">
                                    <td>$2,000 - $3,000</td>
                                    <td>374 vehicles</td>
                                    <td><strong>$1,137</strong></td>
                                </tr>
                                <tr style="background: #3a2a1a;">
                                    <td>$3,000 - $5,000</td>
                                    <td>559 vehicles</td>
                                    <td><strong>$1,008</strong></td>
                                </tr>
                                <tr style="background: #4a1a1a;">
                                    <td>$5,000+</td>
                                    <td>1,006 vehicles</td>
                                    <td><strong>$1,081</strong></td>
                                </tr>
                            </table>

                            <div class="key-point">
                                <strong>The Pattern:</strong> Lower rehab = higher profit. Vehicles under $3,000 rehab consistently outperform those over $3,000.
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Best Performing Makes</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Make</th>
                                    <th>Avg Profit</th>
                                    <th>Avg Rehab</th>
                                </tr>
                                <tr>
                                    <td>GMC</td>
                                    <td><strong>$1,404</strong></td>
                                    <td>$3,428</td>
                                </tr>
                                <tr>
                                    <td>Chevrolet</td>
                                    <td><strong>$1,262</strong></td>
                                    <td>$3,462</td>
                                </tr>
                                <tr>
                                    <td>Ford</td>
                                    <td><strong>$1,245</strong></td>
                                    <td>$3,515</td>
                                </tr>
                                <tr>
                                    <td>Ram</td>
                                    <td>$1,079</td>
                                    <td>$3,697</td>
                                </tr>
                                <tr>
                                    <td>Toyota</td>
                                    <td>$977</td>
                                    <td>$3,277</td>
                                </tr>
                            </table>
                        </div>
                    `
                },
                {
                    id: 'lesson-8-3',
                    title: 'Examples of Winners',
                    content: `
                        <h2>Winners: Deals That Worked</h2>

                        <div class="lesson-section">
                            <h3>What Makes a Winner?</h3>
                            <ul>
                                <li>High profit margin (above $1,500)</li>
                                <li>Low rehab costs (under $2,000)</li>
                                <li>Quick turnaround (under 30 days)</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Winner #1: 2017 Ford F150</h3>
                            <div class="data-example" style="background: #1a3a1a; border-left: 4px solid #4ade80;">
                                <strong style="color: #4ade80;">PROFIT: $4,064</strong><br><br>
                                Sales Price: $26,000<br>
                                Total Cost: $17,696<br>
                                Rehab: $1,055<br>
                                Days on Lot: 17<br><br>
                                <strong>Why It Worked:</strong> Low rehab, quick sale, bought right
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Winner #2: 2019 Chevrolet Silverado</h3>
                            <div class="data-example" style="background: #1a3a1a; border-left: 4px solid #4ade80;">
                                <strong style="color: #4ade80;">PROFIT: $3,847</strong><br><br>
                                Sales Price: $32,500<br>
                                Total Cost: $24,403<br>
                                Rehab: $1,822<br>
                                Days on Lot: 21<br><br>
                                <strong>Why It Worked:</strong> Popular truck, rehab under target, fast flip
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Winner #3: 2018 GMC Sierra Denali</h3>
                            <div class="data-example" style="background: #1a3a1a; border-left: 4px solid #4ade80;">
                                <strong style="color: #4ade80;">PROFIT: $3,512</strong><br><br>
                                Sales Price: $38,900<br>
                                Total Cost: $31,388<br>
                                Rehab: $892<br>
                                Days on Lot: 12<br><br>
                                <strong>Why It Worked:</strong> Minimal rehab, premium trim commands premium price
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Winner #4: 2020 Ram 1500 Big Horn</h3>
                            <div class="data-example" style="background: #1a3a1a; border-left: 4px solid #4ade80;">
                                <strong style="color: #4ade80;">PROFIT: $2,956</strong><br><br>
                                Sales Price: $34,200<br>
                                Total Cost: $27,644<br>
                                Rehab: $1,478<br>
                                Days on Lot: 8<br><br>
                                <strong>Why It Worked:</strong> Super fast turnaround, low floor plan cost
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>The Winner Pattern</h3>
                            <div class="key-point" style="background: #1a3a1a;">
                                <strong>Common traits of profitable deals:</strong>
                                <ul>
                                    <li>Rehab under $2,000</li>
                                    <li>Popular configurations (4WD, crew cab)</li>
                                    <li>Desirable trims (LT, SLT, Big Horn, Lariat)</li>
                                    <li>Sold in under 30 days</li>
                                    <li>Bought at the right price - numbers worked from day one</li>
                                </ul>
                            </div>
                        </div>
                    `
                },
                {
                    id: 'lesson-8-4',
                    title: 'Examples of Losers',
                    content: `
                        <h2>Losers: Deals That Didn't Work</h2>

                        <div class="lesson-section">
                            <h3>What Makes a Loser?</h3>
                            <ul>
                                <li>Lost money on the deal</li>
                                <li>High rehab costs that exceeded estimates</li>
                                <li>Sat on lot too long (high floor plan cost)</li>
                                <li>Had to discount heavily to sell</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Loser #1: 2019 Ford Expedition</h3>
                            <div class="data-example" style="background: #4a1515; border-left: 4px solid #e94560;">
                                <strong style="color: #e94560;">LOSS: -$2,749</strong><br><br>
                                Sales Price: $36,500<br>
                                Total Cost: $34,431<br>
                                Rehab: $4,819<br>
                                Days on Lot: 67<br><br>
                                <strong>What Went Wrong:</strong> Rehab way over budget, sat too long, had to cut price
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Loser #2: 2018 Chevrolet Tahoe</h3>
                            <div class="data-example" style="background: #4a1515; border-left: 4px solid #e94560;">
                                <strong style="color: #e94560;">LOSS: -$1,823</strong><br><br>
                                Sales Price: $28,000<br>
                                Total Cost: $25,473<br>
                                Rehab: $6,241<br>
                                Days on Lot: 89<br><br>
                                <strong>What Went Wrong:</strong> Rehab doubled what was expected, engine work needed
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Loser #3: 2017 Ram 2500</h3>
                            <div class="data-example" style="background: #4a1515; border-left: 4px solid #e94560;">
                                <strong style="color: #e94560;">LOSS: -$1,456</strong><br><br>
                                Sales Price: $31,800<br>
                                Total Cost: $28,756<br>
                                Rehab: $5,892<br>
                                Days on Lot: 104<br><br>
                                <strong>What Went Wrong:</strong> Transmission issues, costly repair, market shifted while sitting
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>The Loser Pattern</h3>
                            <div class="warning-box">
                                <strong>Common traits of losing deals:</strong>
                                <ul>
                                    <li>Rehab exceeded $4,000+ (often $5,000-7,000)</li>
                                    <li>Hidden mechanical problems appeared after purchase</li>
                                    <li>Sat on lot 60+ days (floor plan eats profit)</li>
                                    <li>Had to discount significantly to move the unit</li>
                                    <li>Original buy price was too high for the condition</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Lessons from Losers</h3>
                            <ol>
                                <li><strong>Trust the formula</strong> - If numbers are tight at purchase, they'll be worse at sale</li>
                                <li><strong>Budget for surprises</strong> - Add 20% to your rehab estimate</li>
                                <li><strong>Avoid major mechanical</strong> - Engine/transmission issues kill deals</li>
                                <li><strong>Don't overpay hoping to make it up</strong> - Hope is not a strategy</li>
                                <li><strong>Move units quickly</strong> - Long sits eat your profit in floor plan</li>
                            </ol>
                        </div>
                    `
                },
                {
                    id: 'lesson-8-5',
                    title: 'Key Lessons Summary',
                    content: `
                        <h2>Key Lessons from Real Data</h2>

                        <div class="lesson-section">
                            <h3>The Numbers Don't Lie</h3>
                            <div class="data-example">
                                Our data from 3,627 vehicles proves these rules:
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Lesson 1: Stick to the $3,000 Spread</h3>
                            <div class="key-point" style="background: #1a3a1a;">
                                Vehicles bought with proper $3,000 spread have consistent profits.<br>
                                Vehicles bought "tight" hoping to make it work usually don't.
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Lesson 2: Keep Rehab Under $3,000</h3>
                            <div class="key-point" style="background: #1a3a1a;">
                                Our best performers had rehab under $3,000.<br>
                                Vehicles over $5,000 rehab had 20% lower profit margins on average.
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Lesson 3: Avoid Major Mechanical</h3>
                            <div class="warning-box">
                                Engine and transmission work is where deals go to die.<br>
                                Even with our shop, these jobs run $3,000-6,000+.<br>
                                Better to skip and find a cleaner unit.
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Lesson 4: Turn Units Fast</h3>
                            <div class="key-point">
                                Average days on lot: 35<br>
                                Winners averaged: 15-25 days<br>
                                Losers averaged: 60-100+ days<br><br>
                                <strong>Floor plan costs $10-20/day. 60 extra days = $600-1,200 lost profit.</strong>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Lesson 5: GMC and Chevrolet Trucks Perform Best</h3>
                            <div class="data-example">
                                GMC: $1,404 avg profit<br>
                                Chevrolet: $1,262 avg profit<br>
                                Ford: $1,245 avg profit<br><br>
                                These have strong demand and our shop knows them well.
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Your Checklist Before Every Buy</h3>
                            <div class="calculation-example" style="background: #1a1a2a;">
                                <strong>✓ Is the spread at least $3,000?</strong><br>
                                <strong>✓ Is rehab estimate under $3,000?</strong><br>
                                <strong>✓ Have I accounted for history issues?</strong><br>
                                <strong>✓ No frame, flood, or major mechanical?</strong><br>
                                <strong>✓ Does the CR grade match the price?</strong><br>
                                <strong>✓ Is it a configuration that sells fast?</strong><br><br>

                                If ALL boxes are checked: <span style="color: #4ade80;"><strong>BID</strong></span><br>
                                If ANY box is unchecked: <span style="color: #e94560;"><strong>PASS</strong></span>
                            </div>
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-8',
                title: 'Real Deals Quiz',
                questions: [
                    {
                        question: 'What is the Carz Inc target for maximum rehab costs?',
                        options: [
                            '$1,000',
                            '$2,000',
                            '$3,000',
                            '$5,000'
                        ],
                        correct: 2,
                        explanation: 'Target rehab under $3,000. Vehicles over this threshold have lower profit margins and more risk.'
                    },
                    {
                        question: 'What is the minimum spread we need between book value and purchase price?',
                        options: [
                            '$1,000',
                            '$2,000',
                            '$3,000',
                            '$4,000'
                        ],
                        correct: 2,
                        explanation: '$3,000 minimum spread: $2,000 covers fees and $1,000 is target profit.'
                    },
                    {
                        question: 'Autoniq average is $28,000. Vehicle needs $2,500 rehab. What is the max bid?',
                        options: [
                            '$25,500',
                            '$24,500',
                            '$22,500',
                            '$25,000'
                        ],
                        correct: 2,
                        explanation: '$28,000 - $3,000 (spread) - $2,500 (rehab) = $22,500 max bid.'
                    },
                    {
                        question: 'Based on historical data, which make has the highest average profit?',
                        options: [
                            'Ford',
                            'Ram',
                            'GMC',
                            'Toyota'
                        ],
                        correct: 2,
                        explanation: 'GMC averages $1,404 profit - the highest of the major truck brands in our data.'
                    },
                    {
                        question: 'What is the common pattern in losing deals?',
                        options: [
                            'Low rehab costs',
                            'Quick turnaround',
                            'Rehab over $4,000-5,000 and 60+ days on lot',
                            'Popular configurations'
                        ],
                        correct: 2,
                        explanation: 'Losers typically had rehab exceeding $4,000+ and sat on the lot 60-100+ days, eating profit in floor plan costs.'
                    },
                    {
                        question: 'Average days on lot for our inventory is 35 days. Winning deals average:',
                        options: [
                            '60-90 days',
                            '15-25 days',
                            '45-60 days',
                            '5-10 days'
                        ],
                        correct: 1,
                        explanation: 'Winners sell in 15-25 days on average. Fast turns reduce floor plan costs and improve profitability.'
                    }
                ]
            }
        },
        // Module 9: Interactive Examples
        {
            id: 'module-9',
            title: 'Interactive Examples',
            lessons: [
                {
                    id: 'lesson-9-1',
                    title: 'Example 1: 2018 Ram 1500 Big Horn',
                    content: `
                        <div class="lesson-section">
                            <h2>Real Vehicle Analysis: 2018 Ram 1500 Big Horn Crew Cab 4x4</h2>
                            <p>Let's walk through a complete evaluation of this truck step-by-step, just like you would on auction day.</p>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 1: The Listing (What We See on OVE)</h2>
                            <div class="info-box">
                                <table style="width: 100%;">
                                    <tr><td><strong>Vehicle:</strong></td><td>2018 Ram 1500 Big Horn Crew Cab 4x4</td></tr>
                                    <tr><td><strong>VIN:</strong></td><td>1C6RR7TT0JS******</td></tr>
                                    <tr><td><strong>Mileage:</strong></td><td>102,350</td></tr>
                                    <tr><td><strong>CR Grade:</strong></td><td>3.3</td></tr>
                                    <tr><td><strong>Buy Now Price:</strong></td><td>$12,000</td></tr>
                                    <tr><td><strong>Location:</strong></td><td>Ohio</td></tr>
                                    <tr><td><strong>Color:</strong></td><td>Gray</td></tr>
                                </table>
                            </div>

                            <div class="warning-box">
                                <h3>History Report Findings</h3>
                                <ul>
                                    <li><span style="color: #facc15;">2 accidents reported</span></li>
                                    <li><span style="color: #facc15;">3 owners</span></li>
                                    <li><span style="color: #4ade80;">No frame damage</span></li>
                                    <li><span style="color: #4ade80;">No flood damage</span></li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 2: Pull Book Values (Autoniq)</h2>
                            <p>Here's what Autoniq shows us for this truck:</p>

                            <div class="highlight-box" style="background: #1a3a1a; border-color: #4ade80;">
                                <h3>Black Book Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>XClean:</td><td style="text-align: right;"><strong>$17,675</strong></td></tr>
                                    <tr><td>Clean:</td><td style="text-align: right;"><strong>$15,800</strong></td></tr>
                                    <tr><td>Average:</td><td style="text-align: right;"><strong>$14,100</strong></td></tr>
                                    <tr><td>Rough:</td><td style="text-align: right;"><strong>$12,750</strong></td></tr>
                                </table>
                            </div>

                            <div class="highlight-box" style="background: #1a1a3a; border-color: #818cf8;">
                                <h3>J.D. Power Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>Loan:</td><td style="text-align: right;"><strong>$19,125</strong></td></tr>
                                    <tr><td>Retail:</td><td style="text-align: right;"><strong>$22,075</strong></td></tr>
                                </table>
                            </div>

                            <div class="highlight-box" style="background: #3a1a1a; border-color: #e94560;">
                                <h3>Other Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>MMR (Adjusted):</td><td style="text-align: right;"><strong>$17,700</strong></td></tr>
                                    <tr><td>Retail Index:</td><td style="text-align: right;"><strong>$24,596</strong></td></tr>
                                </table>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 3: Calculate Target Sales Price (at 4.0)</h2>
                            <p>All book values are calculated at <strong>4.0 CR baseline</strong>. We average our three sources:</p>

                            <div class="highlight-box" style="background: #1a2a1a;">
                                <h3>Target Sales Price Calculation</h3>
                                <table style="width: 100%;">
                                    <tr><td>MMR (PRIMARY - at 4.0):</td><td style="text-align: right;"><strong>$17,700</strong></td></tr>
                                    <tr><td>J.D. Power Loan (Secondary):</td><td style="text-align: right;"><strong>$19,125</strong></td></tr>
                                    <tr><td>Black Book XClean (Third):</td><td style="text-align: right;"><strong>$17,675</strong></td></tr>
                                    <tr style="border-top: 2px solid #4ade80;"><td><strong>Average (Target Sales Price):</strong></td><td style="text-align: right;"><strong style="color: #4ade80; font-size: 1.2em;">$18,167</strong></td></tr>
                                </table>
                            </div>

                            <div class="info-box">
                                <h3>Reading the Scale</h3>
                                <ul>
                                    <li><strong>MMR = $17,700</strong> (our baseline at 4.0)</li>
                                    <li><strong>J.D. Power = $19,125</strong> (above MMR = shows upside potential)</li>
                                    <li><strong>Black Book = $17,675</strong> (close to MMR = scale is balanced)</li>
                                </ul>
                                <p style="margin-top: 10px;">J.D. Power being higher means this truck could bring slightly more than MMR. Good sign!</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 4: Estimate Rehab Costs</h2>
                            <p>The truck is CR Grade 3.3 (about 0.7 grades below 4.0). Using our rule of <strong>~$1,000 per grade level</strong>:</p>

                            <div class="highlight-box" style="background: #2a2a1a;">
                                <h3>Total Added Costs</h3>
                                <table style="width: 100%;">
                                    <tr><td>CR Grade 3.3 (~1 grade below 4.0):</td><td style="text-align: right;"><strong style="color: #facc15;">~$1,500</strong></td></tr>
                                </table>
                                <p style="margin-top: 10px; color: #888;">This covers rehab + dealer fees for getting this truck to retail-ready condition.</p>
                            </div>

                            <div class="warning-box">
                                <h3>History Report Note</h3>
                                <p>2 accidents reported. No frame damage, so we proceed with caution but don't add extra deduction - the buyer will factor this into what they'll pay.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 5: Apply the Formula</h2>

                            <div class="calculation-example" style="background: #0a1a0a; border: 3px solid #4ade80; padding: 25px;">
                                <h3 style="color: #4ade80; text-align: center;">MAX BID CALCULATION</h3>
                                <br>
                                <div style="font-size: 1.2em;">
                                    Target Sales Price (at 4.0): <strong>$18,167</strong><br>
                                    <span style="color: #e94560;">− $3,000 (required spread)</span><br>
                                    <span style="color: #facc15;">− $1,500 (rehab for CR 3.3)</span><br>
                                    <hr style="border-color: #4ade80;">
                                    <strong style="font-size: 1.4em;">= $13,667 MAX BID</strong>
                                </div>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 6: The Verdict</h2>

                            <div class="highlight-box" style="background: #1a3a1a; border-color: #4ade80;">
                                <h3 style="color: #4ade80;">BUY NOW: $12,000 vs MAX BID: $13,667</h3>
                                <p style="font-size: 1.3em; text-align: center; color: #4ade80;"><strong>VERDICT: BUY IT! $1,667 under our max!</strong></p>
                            </div>

                            <div class="info-box">
                                <h3>Analysis Summary</h3>
                                <table style="width: 100%;">
                                    <tr style="color: #4ade80;"><td>✓</td><td>4x4 Crew Cab (popular config)</td></tr>
                                    <tr style="color: #4ade80;"><td>✓</td><td>Reasonable mileage for year</td></tr>
                                    <tr style="color: #4ade80;"><td>✓</td><td>Ohio location (manageable shipping)</td></tr>
                                    <tr style="color: #4ade80;"><td>✓</td><td>Rehab under $3,000 target</td></tr>
                                    <tr style="color: #facc15;"><td>⚠</td><td>2 accidents (priced into calculation)</td></tr>
                                    <tr style="color: #facc15;"><td>⚠</td><td>3 owners (slightly higher)</td></tr>
                                </table>
                            </div>

                            <div class="key-point">
                                <h3>Key Takeaway</h3>
                                <p>The Buy Now at $12,000 is <strong>$1,667 UNDER</strong> our max bid of $13,667. This is a BUY! 4x4 Crew Cab with good demand, J.D. Power shows upside, and it's a one-stop rehab car.</p>
                            </div>
                        </div>
                    `
                },
                {
                    id: 'lesson-9-2',
                    title: 'Example 2: 2016 GMC Sierra 1500 SLT',
                    content: `
                        <div class="lesson-section">
                            <h2>Real Vehicle Analysis: 2016 GMC Sierra 1500 SLT Crew Cab</h2>
                            <p>This example shows a vehicle that looks great on paper but has a hidden dealbreaker.</p>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 1: The Listing</h2>
                            <div class="info-box">
                                <table style="width: 100%;">
                                    <tr><td><strong>Vehicle:</strong></td><td>2016 GMC Sierra 1500 SLT Crew Cab</td></tr>
                                    <tr><td><strong>VIN:</strong></td><td>3GTU2PEC4GG******</td></tr>
                                    <tr><td><strong>Mileage:</strong></td><td>102,887</td></tr>
                                    <tr><td><strong>CR Grade:</strong></td><td>3.9 (Above Average!)</td></tr>
                                    <tr><td><strong>Buy Now Price:</strong></td><td>$13,500</td></tr>
                                    <tr><td><strong>Location:</strong></td><td>California</td></tr>
                                    <tr><td><strong>Drivetrain:</strong></td><td style="color: #e94560; font-weight: bold;">RWD (2WD)</td></tr>
                                </table>
                            </div>

                            <div class="highlight-box" style="background: #1a3a1a; border-color: #4ade80;">
                                <h3>History Report - Looks Great!</h3>
                                <ul>
                                    <li><span style="color: #4ade80;">✓ 0 accidents</span></li>
                                    <li><span style="color: #4ade80;">✓ 1 owner</span></li>
                                    <li><span style="color: #4ade80;">✓ No frame damage</span></li>
                                    <li><span style="color: #4ade80;">✓ No flood damage</span></li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 2: Book Values (Autoniq)</h2>

                            <div class="highlight-box" style="background: #1a3a1a; border-color: #4ade80;">
                                <h3>Black Book Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>XClean:</td><td style="text-align: right;"><strong>$18,400</strong></td></tr>
                                    <tr><td>Clean:</td><td style="text-align: right;"><strong>$16,450</strong></td></tr>
                                    <tr><td>Average:</td><td style="text-align: right;"><strong>$14,600</strong></td></tr>
                                    <tr><td>Rough:</td><td style="text-align: right;"><strong>$13,225</strong></td></tr>
                                </table>
                            </div>

                            <div class="highlight-box" style="background: #1a1a3a; border-color: #818cf8;">
                                <h3>J.D. Power Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>Loan:</td><td style="text-align: right;"><strong>$18,050</strong></td></tr>
                                    <tr><td>Retail:</td><td style="text-align: right;"><strong>$20,925</strong></td></tr>
                                </table>
                            </div>

                            <div class="highlight-box" style="background: #3a1a1a; border-color: #e94560;">
                                <h3>Other Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>MMR (Adjusted):</td><td style="text-align: right;"><strong>$16,550</strong></td></tr>
                                    <tr><td>Retail Index:</td><td style="text-align: right;"><strong>$24,486</strong></td></tr>
                                </table>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 3: Check the Configuration - DEMAND!</h2>

                            <div class="warning-box" style="background: #3a3a1a; border-color: #facc15;">
                                <h3 style="color: #facc15;">2WD TRUCK - BE CONSERVATIVE</h3>
                                <p style="font-size: 1.2em;">This is a <strong>2-wheel drive</strong> truck = Lower demand</p>
                                <ul>
                                    <li><strong>Book values already reflect 2WD</strong> - no manual adjustment needed</li>
                                    <li>2WD takes longer to sell than 4WD</li>
                                    <li>Don't stretch - stick to max bid or below</li>
                                    <li>Price conservatively for quick sale</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 4: Calculate Target Sales Price (at 4.0)</h2>

                            <div class="highlight-box" style="background: #1a2a1a;">
                                <h3>Target Sales Price Calculation</h3>
                                <table style="width: 100%;">
                                    <tr><td>MMR (PRIMARY - at 4.0):</td><td style="text-align: right;"><strong>$16,550</strong></td></tr>
                                    <tr><td>J.D. Power Loan (Secondary):</td><td style="text-align: right;"><strong>$18,050</strong></td></tr>
                                    <tr><td>Black Book XClean (Third):</td><td style="text-align: right;"><strong>$18,400</strong></td></tr>
                                    <tr style="border-top: 2px solid #4ade80;"><td><strong>Average (Target Sales Price):</strong></td><td style="text-align: right;"><strong style="color: #4ade80; font-size: 1.2em;">$17,667</strong></td></tr>
                                </table>
                            </div>

                            <div class="calculation-example" style="background: #0a1a0a; border: 3px solid #4ade80; padding: 25px;">
                                <h3 style="color: #4ade80; text-align: center;">MAX BID CALCULATION</h3>
                                <br>
                                <div style="font-size: 1.2em;">
                                    Target Sales Price (at 4.0): <strong>$17,667</strong><br>
                                    <span style="color: #e94560;">− $3,000 (required spread)</span><br>
                                    <span style="color: #facc15;">− $500 (rehab for CR 3.9)</span><br>
                                    <hr style="border-color: #4ade80;">
                                    <strong style="font-size: 1.4em;">= $14,167 MAX BID</strong>
                                </div>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 5: The Verdict</h2>

                            <div class="highlight-box" style="background: #2a3a1a; border-color: #facc15;">
                                <h3 style="color: #facc15;">BUY NOW: $13,500 vs MAX BID: $14,167</h3>
                                <p style="font-size: 1.3em; text-align: center; color: #facc15;"><strong>VERDICT: CAN BUY - But price conservatively!</strong></p>
                            </div>

                            <div class="info-box">
                                <h3>2WD Considerations</h3>
                                <table style="width: 100%;">
                                    <tr style="color: #4ade80;"><td>✓</td><td>Buy Now is $667 UNDER our max bid</td></tr>
                                    <tr style="color: #4ade80;"><td>✓</td><td>Clean history</td></tr>
                                    <tr style="color: #4ade80;"><td>✓</td><td>High CR grade 3.9 = low rehab</td></tr>
                                    <tr style="color: #facc15;"><td>⚠</td><td>2WD = lower demand = price it for quick sale</td></tr>
                                    <tr style="color: #facc15;"><td>⚠</td><td>Don't stretch on 2WD - stick to max or below</td></tr>
                                </table>
                            </div>

                            <div class="key-point">
                                <h3>Lesson Learned: Be Conservative on 2WD</h3>
                                <p><strong>We don't automatically pass on 2WD.</strong> But we make sure our Target Sales Price is conservative and appealing enough for a quick sale. 2WD takes longer to sell, so price it right. Don't stretch - if it's at or below max bid, it can work.</p>
                            </div>
                        </div>
                    `
                },
                {
                    id: 'lesson-9-3',
                    title: 'Example 3: 2016 Silverado LTZ - Transmission Problem',
                    content: `
                        <div class="lesson-section">
                            <h2>Real Vehicle Analysis: 2016 Chevrolet Silverado 1500 LTZ Z71 Crew Cab 4x4</h2>
                            <p>This truck has great specs but a major mechanical issue. Let's see if the math still works.</p>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 1: The Listing</h2>
                            <div class="info-box">
                                <table style="width: 100%;">
                                    <tr><td><strong>Vehicle:</strong></td><td>2016 Chevrolet Silverado 1500 LTZ Z71 4x4</td></tr>
                                    <tr><td><strong>VIN:</strong></td><td>3GCUKSEC0GG******</td></tr>
                                    <tr><td><strong>Mileage:</strong></td><td>100,953</td></tr>
                                    <tr><td><strong>CR Grade:</strong></td><td>3.3</td></tr>
                                    <tr><td><strong>Buy Now Price:</strong></td><td>$17,200</td></tr>
                                    <tr><td><strong>Location:</strong></td><td>Illinois</td></tr>
                                    <tr><td><strong>Color:</strong></td><td>White</td></tr>
                                </table>
                            </div>

                            <div class="warning-box" style="background: #4a1515;">
                                <h3 style="color: #e94560;">CRITICAL CR NOTE:</h3>
                                <p style="font-size: 1.2em; color: #e94560;"><strong>"TRANSMISSION SLIPPING - NEEDS SERVICE"</strong></p>
                            </div>

                            <div class="info-box">
                                <h3>History Report</h3>
                                <ul>
                                    <li><span style="color: #facc15;">1 accident reported</span></li>
                                    <li><span style="color: #facc15;">5 owners (high turnover - red flag)</span></li>
                                    <li><span style="color: #4ade80;">No frame damage</span></li>
                                    <li><span style="color: #4ade80;">No flood damage</span></li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 2: Book Values (Autoniq)</h2>

                            <div class="highlight-box" style="background: #1a3a1a; border-color: #4ade80;">
                                <h3>Black Book Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>XClean:</td><td style="text-align: right;"><strong>$22,075</strong></td></tr>
                                    <tr><td>Clean:</td><td style="text-align: right;"><strong>$19,800</strong></td></tr>
                                    <tr><td>Average:</td><td style="text-align: right;"><strong>$17,750</strong></td></tr>
                                    <tr><td>Rough:</td><td style="text-align: right;"><strong>$15,950</strong></td></tr>
                                </table>
                            </div>

                            <div class="highlight-box" style="background: #3a1a1a; border-color: #e94560;">
                                <h3>Other Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>MMR (Adjusted):</td><td style="text-align: right;"><strong>$23,000</strong></td></tr>
                                    <tr><td>Retail Index:</td><td style="text-align: right;"><strong>$28,944</strong></td></tr>
                                </table>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 3: Research the Transmission</h2>
                            <p>Before bidding, we need to know what a transmission fix costs. Check <strong>Car-Part.com</strong>!</p>

                            <div class="highlight-box" style="background: #2a2a1a;">
                                <h3>Transmission Repair Options</h3>
                                <table style="width: 100%;">
                                    <tr><td>Used transmission (part only):</td><td style="text-align: right;">$1,200-$2,000</td></tr>
                                    <tr><td>Labor to install:</td><td style="text-align: right;">$1,000-$1,500</td></tr>
                                    <tr style="border-top: 2px solid #e94560;"><td><strong>Total Estimated Cost:</strong></td><td style="text-align: right;"><strong style="color: #e94560;">$2,500-$3,500</strong></td></tr>
                                </table>
                            </div>

                            <div class="info-box">
                                <p>Let's use <strong>$3,000</strong> as our transmission estimate to be safe.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 4: Full Rehab Estimate</h2>

                            <div class="highlight-box" style="background: #2a2a1a;">
                                <h3>Total Rehab Costs</h3>
                                <table style="width: 100%;">
                                    <tr><td>Transmission replacement:</td><td style="text-align: right;">$3,000</td></tr>
                                    <tr><td>General detail/cleanup:</td><td style="text-align: right;">$300</td></tr>
                                    <tr><td>Minor cosmetic:</td><td style="text-align: right;">$500</td></tr>
                                    <tr style="border-top: 2px solid #facc15;"><td><strong>Total Rehab:</strong></td><td style="text-align: right;"><strong style="color: #e94560;">$3,800</strong></td></tr>
                                </table>
                            </div>

                            <div class="warning-box">
                                <h3>History Deductions</h3>
                                <ul>
                                    <li>1 accident: <strong>−$1,000</strong></li>
                                    <li>5 owners (high): <strong>−$500</strong> (harder to sell)</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 5: STOP - Multi-Stop Killer!</h2>

                            <div class="danger-box" style="padding: 25px;">
                                <h3 style="color: #e94560; text-align: center; font-size: 1.5em;">MULTI-STOP KILLER - PASS!</h3>
                                <br>
                                <div style="font-size: 1.2em;">
                                    <p><strong>This car needs:</strong></p>
                                    <ul>
                                        <li>Transmission shop (major mechanic work)</li>
                                        <li>Detail shop (cleanup)</li>
                                        <li>Possibly body shop (cosmetic)</li>
                                    </ul>
                                    <p style="margin-top: 15px;"><strong>Multiple stops = KILLER. Don't even calculate.</strong></p>
                                </div>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 6: The Verdict</h2>

                            <div class="highlight-box" style="background: #3a1a1a; border-color: #e94560;">
                                <h3 style="color: #e94560;">VERDICT: PASS - MULTI-STOP KILLER</h3>
                                <p style="font-size: 1.3em; text-align: center; color: #e94560;"><strong>Transmission + other work = TOO MANY STOPS</strong></p>
                            </div>

                            <div class="info-box">
                                <h3>Why We're Passing</h3>
                                <table style="width: 100%;">
                                    <tr style="color: #e94560;"><td>✗</td><td>MULTI-STOP KILLER - mechanic + detail/body</td></tr>
                                    <tr style="color: #e94560;"><td>✗</td><td>Transmission is unpredictable - could cost more</td></tr>
                                    <tr style="color: #e94560;"><td>✗</td><td>5 owners = problem history</td></tr>
                                    <tr style="color: #e94560;"><td>✗</td><td>More time sitting = more fees</td></tr>
                                    <tr style="color: #4ade80;"><td>✓</td><td>Good config (Z71 4x4) - but not worth the risk</td></tr>
                                </table>
                            </div>

                            <div class="key-point">
                                <h3>Lesson Learned</h3>
                                <p><strong>We want ONE-STOP rehab cars.</strong> Transmission issues mean mechanic shop PLUS whatever else it needs. That's multiple stops = killer. Don't waste time calculating - just PASS and find a better deal.</p>
                            </div>
                        </div>
                    `
                },
                {
                    id: 'lesson-9-4',
                    title: 'Example 4: 2019 Equinox LT - Rough Grade Opportunity',
                    content: `
                        <div class="lesson-section">
                            <h2>Real Vehicle Analysis: 2019 Chevrolet Equinox LT AWD</h2>
                            <p>This is a CR Grade 2.0 vehicle - rough condition. Let's see if the price reflects the condition.</p>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 1: The Listing</h2>
                            <div class="info-box">
                                <table style="width: 100%;">
                                    <tr><td><strong>Vehicle:</strong></td><td>2019 Chevrolet Equinox LT AWD</td></tr>
                                    <tr><td><strong>VIN:</strong></td><td>2GNAXVEX4K6******</td></tr>
                                    <tr><td><strong>Mileage:</strong></td><td>73,317</td></tr>
                                    <tr><td><strong>CR Grade:</strong></td><td style="color: #facc15;"><strong>2.0 (Below Average/Rough)</strong></td></tr>
                                    <tr><td><strong>Sale Price:</strong></td><td style="color: #4ade80;">SOLD @ $8,400</td></tr>
                                    <tr><td><strong>Location:</strong></td><td>Listed Location</td></tr>
                                </table>
                            </div>

                            <div class="warning-box">
                                <h3>CR Notes - Lots of Issues!</h3>
                                <ul>
                                    <li><span style="color: #e94560;">Interior smoke odor</span></li>
                                    <li><span style="color: #e94560;">Airbag light on</span></li>
                                    <li><span style="color: #facc15;">Tires need replacement</span></li>
                                    <li><span style="color: #facc15;">Multiple interior stains/damage</span></li>
                                    <li><span style="color: #facc15;">Exterior scratches/dings</span></li>
                                </ul>
                            </div>

                            <div class="highlight-box" style="background: #1a3a1a;">
                                <h3>History Report</h3>
                                <ul>
                                    <li><span style="color: #4ade80;">✓ 0 accidents</span></li>
                                    <li><span style="color: #4ade80;">✓ 2 owners</span></li>
                                    <li><span style="color: #4ade80;">✓ No frame damage</span></li>
                                    <li><span style="color: #4ade80;">✓ No flood damage</span></li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 2: Book Values (Autoniq)</h2>

                            <div class="highlight-box" style="background: #1a3a1a; border-color: #4ade80;">
                                <h3>Black Book Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>XClean:</td><td style="text-align: right;"><strong>$13,175</strong></td></tr>
                                    <tr><td>Clean:</td><td style="text-align: right;"><strong>$11,675</strong></td></tr>
                                    <tr><td>Average:</td><td style="text-align: right;"><strong>$10,300</strong></td></tr>
                                    <tr><td>Rough:</td><td style="text-align: right;"><strong>$9,350</strong></td></tr>
                                </table>
                            </div>

                            <div class="highlight-box" style="background: #3a1a1a; border-color: #e94560;">
                                <h3>Other Values</h3>
                                <table style="width: 100%;">
                                    <tr><td>MMR (Adjusted):</td><td style="text-align: right;"><strong>$8,500</strong></td></tr>
                                    <tr><td>Retail Index:</td><td style="text-align: right;"><strong>$17,792</strong></td></tr>
                                </table>
                            </div>

                            <div class="info-box">
                                <p><strong>Note:</strong> For a Grade 2.0 vehicle, we should use closer to the ROUGH value, not Average.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 3: Detailed Rehab Estimate</h2>

                            <div class="highlight-box" style="background: #2a2a1a;">
                                <h3>Rehab Cost Breakdown</h3>
                                <table style="width: 100%;">
                                    <tr><td>Ozone treatment (smoke odor):</td><td style="text-align: right;">$100</td></tr>
                                    <tr><td>Airbag light diagnosis/repair:</td><td style="text-align: right;">$200-$800</td></tr>
                                    <tr><td>New tires (set of 4 @ $70/tire for SUV):</td><td style="text-align: right;">$280</td></tr>
                                    <tr><td>Interior deep clean + repairs:</td><td style="text-align: right;">$400</td></tr>
                                    <tr><td>Touch-up paint/PDR:</td><td style="text-align: right;">$400</td></tr>
                                    <tr style="border-top: 2px solid #facc15;"><td><strong>Total Rehab Estimate:</strong></td><td style="text-align: right;"><strong style="color: #facc15;">$1,680</strong></td></tr>
                                </table>
                            </div>

                            <div class="info-box">
                                <p><strong>Rehab is under $3,000!</strong> This is promising despite all the issues.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 4: Wait - Is This a Multi-Stop?</h2>

                            <div class="warning-box">
                                <h3>Check the Stops:</h3>
                                <ul>
                                    <li>Airbag light + tires = <strong>Mechanic shop</strong></li>
                                    <li>Ozone + interior = <strong>Detail shop</strong></li>
                                    <li>Touch-up paint/PDR = <strong>Body shop</strong></li>
                                </ul>
                                <p style="margin-top: 10px;"><strong>3 STOPS = Borderline killer.</strong> Proceed with extreme caution.</p>
                            </div>

                            <div class="calculation-example" style="background: #0a1a0a; border: 3px solid #4ade80; padding: 25px;">
                                <h3 style="color: #4ade80; text-align: center;">MAX BID (if we bought it)</h3>
                                <br>
                                <div style="font-size: 1.2em;">
                                    Target Sales Price (at 4.0): <strong>~$11,000</strong><br>
                                    <span style="color: #e94560;">− $3,000 (required spread)</span><br>
                                    <span style="color: #facc15;">− $2,000 (rehab for CR 2.0)</span><br>
                                    <hr style="border-color: #4ade80;">
                                    <strong style="font-size: 1.4em;">= $6,000 MAX BID</strong>
                                </div>
                            </div>

                            <div class="calculation-example" style="background: #1a3a1a;">
                                <h3>This vehicle SOLD for $8,400</h3>
                                <p>That's <strong>$2,400 OVER our max bid!</strong></p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h2>Step 5: The Verdict</h2>

                            <div class="highlight-box" style="background: #3a2a1a; border-color: #facc15;">
                                <h3 style="color: #facc15;">SOLD: $8,400 vs MAX BID: $6,000</h3>
                                <p style="font-size: 1.3em; text-align: center; color: #facc15;"><strong>VERDICT: LET IT GO - SOMEONE OVERPAID</strong></p>
                            </div>

                            <div class="info-box">
                                <h3>Analysis</h3>
                                <table style="width: 100%;">
                                    <tr style="color: #e94560;"><td>✗</td><td>Borderline multi-stop (mechanic + detail + body)</td></tr>
                                    <tr style="color: #e94560;"><td>✗</td><td>Sold price $2,400 over our max</td></tr>
                                    <tr style="color: #e94560;"><td>✗</td><td>Airbag light = unknown cost risk</td></tr>
                                    <tr style="color: #e94560;"><td>✗</td><td>Smoke odor is hard to fully eliminate</td></tr>
                                    <tr style="color: #4ade80;"><td>✓</td><td>Clean history, AWD, lower mileage</td></tr>
                                </table>
                            </div>

                            <div class="key-point">
                                <h3>Lesson Learned</h3>
                                <p><strong>Rough grade vehicles CAN be opportunities, but the price must reflect the condition.</strong> Whoever bought this at $8,400 is either:</p>
                                <ol>
                                    <li>A retail buyer who doesn't know better</li>
                                    <li>A dealer with lower rehab costs than us</li>
                                    <li>About to lose money</li>
                                </ol>
                                <p style="margin-top: 15px;">Stick to your formula. Let someone else overpay.</p>
                            </div>
                        </div>
                    `
                },
                {
                    id: 'lesson-9-5',
                    title: 'Practice: Calculate Your Own',
                    content: `
                        <div class="lesson-section">
                            <h2>Practice Time: Calculate These Deals</h2>
                            <p>Now it's your turn. Use the formula to calculate the max bid for these scenarios. Write down your answers before checking!</p>
                        </div>

                        <div class="lesson-section">
                            <h2>Scenario 1: Clean Truck</h2>
                            <div class="info-box">
                                <table style="width: 100%;">
                                    <tr><td><strong>Vehicle:</strong></td><td>2019 Ford F-150 XLT 4x4 Crew Cab</td></tr>
                                    <tr><td><strong>CR Grade:</strong></td><td>3.5</td></tr>
                                    <tr><td><strong>Target Sales Price (at 4.0):</strong></td><td>$26,000</td></tr>
                                    <tr><td><strong>History:</strong></td><td>0 accidents, 2 owners</td></tr>
                                    <tr><td><strong>Estimated Rehab:</strong></td><td>$500 (detail only)</td></tr>
                                    <tr><td><strong>Buy Now:</strong></td><td>$21,500</td></tr>
                                </table>
                            </div>

                            <details style="margin-top: 20px;">
                                <summary style="cursor: pointer; color: #4ade80; font-weight: bold;">Click to reveal answer</summary>
                                <div class="calculation-example" style="margin-top: 15px;">
                                    <strong>$26,000 - $3,000 - $500 = $22,500 Max Bid</strong><br><br>
                                    Buy Now at $21,500 is UNDER max bid!<br>
                                    <span style="color: #4ade80;"><strong>VERDICT: BUY IT!</strong></span>
                                </div>
                            </details>
                        </div>

                        <div class="lesson-section">
                            <h2>Scenario 2: Accident History</h2>
                            <div class="info-box">
                                <table style="width: 100%;">
                                    <tr><td><strong>Vehicle:</strong></td><td>2018 GMC Sierra SLE 4x4</td></tr>
                                    <tr><td><strong>CR Grade:</strong></td><td>3.0</td></tr>
                                    <tr><td><strong>Target Sales Price (at 4.0):</strong></td><td>$22,000</td></tr>
                                    <tr><td><strong>History:</strong></td><td>1 moderate accident, 3 owners</td></tr>
                                    <tr><td><strong>Estimated Rehab:</strong></td><td>$1,200</td></tr>
                                    <tr><td><strong>Buy Now:</strong></td><td>$15,000</td></tr>
                                </table>
                            </div>

                            <details style="margin-top: 20px;">
                                <summary style="cursor: pointer; color: #4ade80; font-weight: bold;">Click to reveal answer</summary>
                                <div class="calculation-example" style="margin-top: 15px;">
                                    <strong>$22,000 - $3,000 - $1,200 - $2,500 (accident deduction) = $15,300 Max Bid</strong><br><br>
                                    Buy Now at $15,000 is UNDER max bid!<br>
                                    <span style="color: #4ade80;"><strong>VERDICT: BUY IT!</strong></span><br>
                                    (Just barely, but the math works)
                                </div>
                            </details>
                        </div>

                        <div class="lesson-section">
                            <h2>Scenario 3: Mechanical Issue</h2>
                            <div class="info-box">
                                <table style="width: 100%;">
                                    <tr><td><strong>Vehicle:</strong></td><td>2017 Ram 1500 Big Horn 4x4</td></tr>
                                    <tr><td><strong>CR Grade:</strong></td><td>2.5</td></tr>
                                    <tr><td><strong>Target Sales Price (at 4.0):</strong></td><td>$18,500</td></tr>
                                    <tr><td><strong>History:</strong></td><td>0 accidents, 2 owners</td></tr>
                                    <tr><td><strong>CR Notes:</strong></td><td>"Check engine light - cylinder misfire"</td></tr>
                                    <tr><td><strong>Estimated Rehab:</strong></td><td>$2,500 (engine work + detail)</td></tr>
                                    <tr><td><strong>Buy Now:</strong></td><td>$13,000</td></tr>
                                </table>
                            </div>

                            <details style="margin-top: 20px;">
                                <summary style="cursor: pointer; color: #4ade80; font-weight: bold;">Click to reveal answer</summary>
                                <div class="calculation-example" style="margin-top: 15px;">
                                    <strong>$18,500 - $3,000 - $2,500 = $13,000 Max Bid</strong><br><br>
                                    Buy Now at $13,000 is EXACTLY at max bid!<br>
                                    <span style="color: #facc15;"><strong>VERDICT: MAYBE - Risky</strong></span><br>
                                    At max bid, there's no margin for error. If engine work costs more than estimated, you lose money. Better to bid lower or pass.
                                </div>
                            </details>
                        </div>

                        <div class="lesson-section">
                            <h2>Scenario 4: 2WD - Low Demand</h2>
                            <div class="info-box">
                                <table style="width: 100%;">
                                    <tr><td><strong>Vehicle:</strong></td><td>2019 Chevrolet Silverado LT <strong style="color: #e94560;">2WD (LOW DEMAND)</strong></td></tr>
                                    <tr><td><strong>CR Grade:</strong></td><td>4.0</td></tr>
                                    <tr><td><strong>Target Sales Price (at 4.0):</strong></td><td>$24,000 <span style="color: #888;">(already reflects 2WD value)</span></td></tr>
                                    <tr><td><strong>History:</strong></td><td>0 accidents, 1 owner</td></tr>
                                    <tr><td><strong>Estimated Rehab:</strong></td><td>$0</td></tr>
                                    <tr><td><strong>Buy Now:</strong></td><td>$20,000</td></tr>
                                </table>
                            </div>

                            <details style="margin-top: 20px;">
                                <summary style="cursor: pointer; color: #4ade80; font-weight: bold;">Click to reveal answer</summary>
                                <div class="calculation-example" style="margin-top: 15px;">
                                    <strong>Book value already reflects 2WD - no adjustment needed!</strong><br><br>
                                    <strong>$24,000 - $3,000 - $0 = $21,000 Max Bid</strong><br><br>
                                    Buy Now at $20,000 is UNDER max bid...<br>
                                    <span style="color: #facc15;"><strong>VERDICT: PROCEED WITH CAUTION</strong></span><br><br>
                                    <strong style="color: #e94560;">BUT REMEMBER: 2WD = LOW DEMAND</strong><br>
                                    The math works, but this is cold inventory. It will sit 60-90 days vs 25-35 for 4WD. Don't stretch on low demand vehicles - stick to your max bid or pass.
                                </div>
                            </details>
                        </div>

                        <div class="lesson-section">
                            <h2>The Golden Rules</h2>
                            <div class="highlight-box" style="background: #1a3a1a; border: 2px solid #4ade80; padding: 25px;">
                                <ol style="font-size: 1.1em; line-height: 2;">
                                    <li><strong style="color: #4ade80;">TARGET DEMAND</strong> - 4WD crew cab sells fast, 2WD sits</li>
                                    <li><strong>ALWAYS pull history reports</strong> - Carfax AND AutoCheck</li>
                                    <li><strong>ALWAYS check drivetrain</strong> - high demand (4WD) vs low demand (2WD)</li>
                                    <li><strong>ALWAYS read the ENTIRE CR</strong> - don't miss mechanical notes</li>
                                    <li><strong>ALWAYS calculate BEFORE bidding</strong> - write down your max</li>
                                    <li><strong>Can stretch on HIGH DEMAND</strong> - 4WD sells quick, less risk</li>
                                    <li><strong>Stick to numbers on LOW DEMAND</strong> - 2WD is cold, don't overpay</li>
                                    <li><strong>NEVER skip Car-Part.com</strong> for major mechanical</li>
                                    <li><strong>$3,000 spread minimum</strong> - no exceptions</li>
                                    <li><strong>When in doubt, PASS</strong> - there's always another truck</li>
                                </ol>
                            </div>
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-9',
                title: 'Interactive Examples Quiz',
                questions: [
                    {
                        question: 'Target Sales Price is $20,000. Rehab is $1,500. What is the max bid?',
                        options: [
                            '$15,500',
                            '$17,000',
                            '$16,500',
                            '$18,500'
                        ],
                        correct: 0,
                        explanation: '$20,000 - $3,000 (spread) - $1,500 (rehab) = $15,500 max bid'
                    },
                    {
                        question: 'A truck is 2WD. What should you consider?',
                        options: [
                            'Pass automatically - never buy 2WD',
                            'Be conservative - price it for a quick sale',
                            'Bid the same as 4WD',
                            'Add $2,000 to max bid'
                        ],
                        correct: 1,
                        explanation: '2WD = lower demand. We don\'t automatically pass - we just make sure our Target Sales Price is conservative and appealing enough for a quick sale.'
                    },
                    {
                        question: 'A car needs mechanic work AND body work. What type of car is this?',
                        options: [
                            'Good deal',
                            'One-stop rehab',
                            'Multi-stop killer - pass',
                            'Easy flip'
                        ],
                        correct: 2,
                        explanation: 'Mechanic + body shop = MULTI-STOP KILLER. We want ONE-STOP rehab cars only.'
                    },
                    {
                        question: 'What is the minimum spread required?',
                        options: [
                            '$1,000',
                            '$2,000',
                            '$3,000',
                            '$5,000'
                        ],
                        correct: 2,
                        explanation: '$3,000 minimum spread covers $2,000 fees + $1,000 profit. Rehab is on top of this.'
                    },
                    {
                        question: 'CR Grade 3.0 is about how much in rehab costs?',
                        options: [
                            '$500',
                            '$1,500',
                            '$3,000',
                            '$4,000'
                        ],
                        correct: 1,
                        explanation: '~$1,000 per grade level below 4.0. CR 3.0 = 1 grade below = ~$1,500 total added costs.'
                    },
                    {
                        question: 'You get outbid on a truck. What do you do?',
                        options: [
                            'Bid higher to win',
                            'Let it go - don\'t chase',
                            'Call the seller',
                            'Wait and rebid'
                        ],
                        correct: 1,
                        explanation: 'Don\'t chase if outbid - let it go. Losing a deal is better than losing money.'
                    }
                ]
            }
        },
        {
            id: 'module-10',
            title: 'Understanding Demand - Our #1 Priority',
            lessons: [
                {
                    id: 'lesson-10-1',
                    title: 'Why Demand is Everything',
                    content: `
                        <h2>Why Demand is Everything</h2>

                        <div class="highlight-box" style="background: #1a3a1a; border: 3px solid #4ade80; padding: 30px;">
                            <h3 style="color: #4ade80; font-size: 1.5em; text-align: center;">WE TARGET DEMAND - THAT'S OUR #1 PRIORITY</h3>
                            <p style="font-size: 1.2em; text-align: center;">A high-demand vehicle sells fast. A low-demand vehicle sits. Time on lot = fees eating profit.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>What is Demand?</h3>
                            <p><strong>Demand</strong> = How many buyers want this exact configuration.</p>
                            <ul>
                                <li><strong style="color: #4ade80;">HIGH DEMAND:</strong> Lots of buyers want it → Sells fast (25-35 days) → Low risk</li>
                                <li><strong style="color: #e94560;">LOW DEMAND:</strong> Few buyers want it → Sits on lot (60-90+ days) → High risk</li>
                            </ul>
                        </div>

                        <div class="lesson-section">
                            <h3>Why Does Demand Matter More Than Price?</h3>
                            <p>Your profit isn't locked in until the vehicle SELLS. Until then:</p>
                            <table class="data-table">
                                <tr>
                                    <th>Time on Lot</th>
                                    <th>Floor Plan Fee</th>
                                    <th>Profit Impact</th>
                                </tr>
                                <tr>
                                    <td>30 days</td>
                                    <td>~$150</td>
                                    <td style="color: #4ade80;">Normal - expected</td>
                                </tr>
                                <tr>
                                    <td>60 days</td>
                                    <td>~$300</td>
                                    <td style="color: #facc15;">Eating into profit</td>
                                </tr>
                                <tr>
                                    <td>90 days</td>
                                    <td>~$450</td>
                                    <td style="color: #e94560;">Serious profit loss</td>
                                </tr>
                                <tr>
                                    <td>120+ days</td>
                                    <td>$600+</td>
                                    <td style="color: #e94560;">May lose money</td>
                                </tr>
                            </table>
                            <p style="margin-top: 15px;"><strong>Plus:</strong> Market prices can drop while you're waiting. Your "great deal" can turn into a loss.</p>
                        </div>

                        <div class="lesson-section">
                            <h3>Capital is Tied Up</h3>
                            <div class="warning-box">
                                <p>While a cold vehicle sits, that money is LOCKED UP. You can't use it to buy other (better) deals.</p>
                                <p>One slow mover can block you from buying 2-3 fast sellers that would have been more profitable.</p>
                            </div>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">THE RULE:</h3>
                            <p style="font-size: 1.2em;">A fast nickel beats a slow dime. Target vehicles that MOVE.</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-10-2',
                    title: 'High Demand Indicators',
                    content: `
                        <h2>High Demand Indicators - What Sells Fast</h2>

                        <div class="lesson-section">
                            <h3 style="color: #4ade80;">HIGH DEMAND = THESE CONFIGURATIONS SELL FAST</h3>

                            <table class="data-table">
                                <tr>
                                    <th>Feature</th>
                                    <th>High Demand Option</th>
                                    <th>Why It Sells Fast</th>
                                </tr>
                                <tr>
                                    <td><strong>Drivetrain</strong></td>
                                    <td style="color: #4ade80;"><strong>4WD / 4x4</strong></td>
                                    <td>Everyone wants capability, works in all climates</td>
                                </tr>
                                <tr>
                                    <td><strong>Cab Type</strong></td>
                                    <td style="color: #4ade80;"><strong>Crew Cab</strong></td>
                                    <td>Full back seat = family friendly</td>
                                </tr>
                                <tr>
                                    <td><strong>Bed Length</strong></td>
                                    <td style="color: #4ade80;"><strong>5.5' or 6.5'</strong></td>
                                    <td>Short or standard bed - most versatile</td>
                                </tr>
                                <tr>
                                    <td><strong>Trim Level</strong></td>
                                    <td style="color: #4ade80;"><strong>LT/SLT/Lariat/Laramie</strong></td>
                                    <td>Mid-tier = features without premium price</td>
                                </tr>
                                <tr>
                                    <td><strong>Colors</strong></td>
                                    <td style="color: #4ade80;"><strong>White, Black, Silver, Gray</strong></td>
                                    <td>Neutral colors appeal to most buyers</td>
                                </tr>
                                <tr>
                                    <td><strong>Engine</strong></td>
                                    <td style="color: #4ade80;"><strong>V8, EcoBoost, Diesel</strong></td>
                                    <td>Power and capability</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>The "Hot Seller" Configuration</h3>
                            <div class="highlight-box" style="background: #0a1a0a; border: 2px solid #4ade80;">
                                <h4 style="color: #4ade80;">Example: High Demand Truck</h4>
                                <p><strong>2021 Ram 1500 Big Horn Crew Cab 4x4</strong></p>
                                <ul>
                                    <li>4WD ✓</li>
                                    <li>Crew Cab ✓</li>
                                    <li>Popular trim (Big Horn) ✓</li>
                                    <li>White/Black/Silver ✓</li>
                                </ul>
                                <p style="color: #4ade80; font-weight: bold; margin-top: 15px;">This sells in 25-35 days. You can stretch a bit on price because it will MOVE.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>When You Can Stretch on Price</h3>
                            <div class="info-box">
                                <p>For HIGH DEMAND vehicles, if the numbers are close to your max bid, you can consider stretching a little because:</p>
                                <ul>
                                    <li>It will sell fast → Less floor plan fees</li>
                                    <li>Quick turn → Capital freed for next deal</li>
                                    <li>Lower risk of market price drops</li>
                                    <li>Slight overpay offset by fast sale</li>
                                </ul>
                                <p><strong>But don't go crazy</strong> - stretching means $500-1,000 over max, not $3,000.</p>
                            </div>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">HIGH DEMAND VEHICLES:</h3>
                            <p style="font-size: 1.2em;">4WD + Crew Cab + Popular Trim + Neutral Color = FAST SELLER = Can stretch on price</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-10-3',
                    title: 'Low Demand Indicators',
                    content: `
                        <h2>Low Demand Indicators - What Sits on the Lot</h2>

                        <div class="lesson-section">
                            <h3 style="color: #e94560;">LOW DEMAND = COLD INVENTORY = DON'T OVERPAY</h3>

                            <table class="data-table">
                                <tr>
                                    <th>Feature</th>
                                    <th>Low Demand Option</th>
                                    <th>Why It Sits</th>
                                </tr>
                                <tr>
                                    <td><strong>Drivetrain</strong></td>
                                    <td style="color: #e94560;"><strong>2WD / RWD</strong></td>
                                    <td>Limited to warm climates, less capable</td>
                                </tr>
                                <tr>
                                    <td><strong>Cab Type</strong></td>
                                    <td style="color: #e94560;"><strong>Extended Cab / Regular Cab</strong></td>
                                    <td>Small or no back seat = limited market</td>
                                </tr>
                                <tr>
                                    <td><strong>Bed Length</strong></td>
                                    <td style="color: #e94560;"><strong>8' Long Bed</strong></td>
                                    <td>Hard to park, commercial look</td>
                                </tr>
                                <tr>
                                    <td><strong>Trim Level</strong></td>
                                    <td style="color: #e94560;"><strong>Work Truck (WT)</strong></td>
                                    <td>Base model = no features, commercial market only</td>
                                </tr>
                                <tr>
                                    <td><strong>Colors</strong></td>
                                    <td style="color: #e94560;"><strong>Bright Red, Yellow, Orange, Green</strong></td>
                                    <td>Unusual colors = smaller buyer pool</td>
                                </tr>
                                <tr>
                                    <td><strong>Engine</strong></td>
                                    <td style="color: #e94560;"><strong>Base V6 in full-size truck</strong></td>
                                    <td>Buyers want power in a truck</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>The "Lot Sitter" Configuration</h3>
                            <div class="warning-box" style="border-color: #e94560;">
                                <h4 style="color: #e94560;">Example: Low Demand Truck</h4>
                                <p><strong>2019 GMC Sierra SLT Extended Cab 2WD Long Bed</strong></p>
                                <ul>
                                    <li>2WD ✗ (limited market)</li>
                                    <li>Extended Cab ✗ (no full back seat)</li>
                                    <li>Long Bed ✗ (hard to park)</li>
                                </ul>
                                <p style="color: #e94560; font-weight: bold; margin-top: 15px;">This sits 60-90+ days. DO NOT stretch on price - stick to your max bid or pass.</p>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>The Rule for Low Demand</h3>
                            <div class="highlight-box" style="background: #2a1515; border: 2px solid #e94560;">
                                <h4 style="color: #e94560;">STICK TO YOUR NUMBER</h4>
                                <p>For LOW DEMAND vehicles:</p>
                                <ul>
                                    <li>Calculate your max bid as normal</li>
                                    <li><strong>DO NOT STRETCH</strong> - even $500 over is too much</li>
                                    <li>If Buy Now is over your max, PASS</li>
                                    <li>There's always another truck - a better one</li>
                                </ul>
                                <p style="margin-top: 15px;">The longer it sits, the more it costs you. Stretching on cold inventory just means a bigger loss.</p>
                            </div>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #e94560;">LOW DEMAND VEHICLES:</h3>
                            <p style="font-size: 1.2em;">2WD + Extended/Regular Cab + Weird Color = COLD INVENTORY = Stick to your max bid or PASS</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-10-4',
                    title: 'How to Check Demand from a Listing',
                    content: `
                        <h2>How to Check Demand from a Listing</h2>

                        <div class="lesson-section">
                            <h3>Quick Demand Checklist</h3>
                            <p>Before you even calculate max bid, run through this checklist:</p>

                            <div class="highlight-box" style="border-color: #818cf8;">
                                <h4 style="color: #818cf8;">DEMAND CHECK (Do This FIRST)</h4>
                                <table style="width: 100%;">
                                    <tr>
                                        <td style="width: 60%;">1. Drivetrain?</td>
                                        <td><span style="color: #4ade80;">4WD/AWD = HOT</span> | <span style="color: #e94560;">2WD/RWD = COLD</span></td>
                                    </tr>
                                    <tr>
                                        <td>2. Cab Type?</td>
                                        <td><span style="color: #4ade80;">Crew = HOT</span> | <span style="color: #e94560;">Extended/Regular = COLD</span></td>
                                    </tr>
                                    <tr>
                                        <td>3. Bed Length?</td>
                                        <td><span style="color: #4ade80;">5.5'/6.5' = HOT</span> | <span style="color: #e94560;">8' = COLD</span></td>
                                    </tr>
                                    <tr>
                                        <td>4. Trim Level?</td>
                                        <td><span style="color: #4ade80;">Mid/High = HOT</span> | <span style="color: #e94560;">Work Truck = COLD</span></td>
                                    </tr>
                                    <tr>
                                        <td>5. Color?</td>
                                        <td><span style="color: #4ade80;">Neutral = HOT</span> | <span style="color: #e94560;">Unusual = COLD</span></td>
                                    </tr>
                                </table>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Where to Find This Info on OVE</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Info</th>
                                    <th>Location on OVE Listing</th>
                                </tr>
                                <tr>
                                    <td>Drivetrain</td>
                                    <td>Listed as "Drivetrain" or "Drive" - 4WD, AWD, RWD, FWD</td>
                                </tr>
                                <tr>
                                    <td>Cab Type</td>
                                    <td>In the vehicle title or body style - "Crew Cab", "Double Cab", "Extended Cab"</td>
                                </tr>
                                <tr>
                                    <td>Bed Length</td>
                                    <td>In title or specs - "Short Bed", "6.5' Bed", "8' Bed"</td>
                                </tr>
                                <tr>
                                    <td>Trim</td>
                                    <td>In vehicle title - LT, SLT, Lariat, Limited, etc.</td>
                                </tr>
                                <tr>
                                    <td>Color</td>
                                    <td>Listed as "Exterior Color" - look at photos too</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>Scoring Demand</h3>
                            <div class="info-box">
                                <p><strong>Quick Score Method:</strong></p>
                                <ul>
                                    <li><strong style="color: #4ade80;">5 HOT factors:</strong> High demand - can stretch</li>
                                    <li><strong style="color: #4ade80;">4 HOT factors:</strong> Good demand - normal process</li>
                                    <li><strong style="color: #facc15;">3 HOT factors:</strong> Mixed - be careful</li>
                                    <li><strong style="color: #e94560;">2 or fewer HOT factors:</strong> Cold inventory - stick to number or pass</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Example: Checking a Real Listing</h3>
                            <div class="calculation-example">
                                <strong>Listing: 2020 Chevrolet Silverado 1500 LT Crew Cab 4WD</strong><br><br>

                                Drivetrain: 4WD ✓ HOT<br>
                                Cab: Crew Cab ✓ HOT<br>
                                Trim: LT ✓ HOT<br>
                                Color: White ✓ HOT<br>
                                Bed: 5.5' Short ✓ HOT<br><br>

                                <span style="color: #4ade80;"><strong>VERDICT: 5/5 HOT = HIGH DEMAND</strong></span><br>
                                This will move fast. Can stretch on price if needed.
                            </div>

                            <div class="calculation-example" style="margin-top: 20px;">
                                <strong>Listing: 2019 GMC Sierra 1500 SLT Extended Cab 2WD</strong><br><br>

                                Drivetrain: 2WD ✗ COLD<br>
                                Cab: Extended Cab ✗ COLD<br>
                                Trim: SLT ✓ HOT<br>
                                Color: Silver ✓ HOT<br>
                                Bed: 6.5' Standard ✓ HOT<br><br>

                                <span style="color: #e94560;"><strong>VERDICT: 3/5 HOT = MIXED/COLD</strong></span><br>
                                2WD + Extended Cab are deal breakers. This will sit. Don't stretch.
                            </div>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">CHECK DEMAND FIRST:</h3>
                            <p style="font-size: 1.2em;">Before you crunch numbers, check the configuration. High demand = green light to evaluate. Low demand = proceed with extreme caution or pass.</p>
                        </div>
                    `
                },
                {
                    id: 'lesson-10-5',
                    title: 'Demand Summary - The Decision Framework',
                    content: `
                        <h2>Demand Summary - The Decision Framework</h2>

                        <div class="highlight-box" style="background: #1a3a1a; border: 3px solid #4ade80; padding: 30px;">
                            <h3 style="color: #4ade80; text-align: center; font-size: 1.5em;">THE CARZ INC DEMAND FRAMEWORK</h3>
                        </div>

                        <div class="lesson-section">
                            <h3>Step 1: Check Demand FIRST</h3>
                            <div class="info-box">
                                <p>Before calculating anything, ask: <strong>Is this high demand or low demand?</strong></p>
                                <ul>
                                    <li>4WD or 2WD?</li>
                                    <li>Crew Cab or Extended/Regular?</li>
                                    <li>Popular trim or base model?</li>
                                    <li>Normal color or unusual?</li>
                                </ul>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Step 2: Apply the Right Strategy</h3>
                            <table class="data-table">
                                <tr>
                                    <th>Demand Level</th>
                                    <th>Strategy</th>
                                    <th>What This Means</th>
                                </tr>
                                <tr style="background: rgba(74, 222, 128, 0.2);">
                                    <td style="color: #4ade80; font-weight: bold;">HIGH DEMAND</td>
                                    <td>Can stretch on price</td>
                                    <td>If numbers are close to max bid, okay to go $500-1,000 over. It will sell fast.</td>
                                </tr>
                                <tr style="background: rgba(250, 204, 21, 0.1);">
                                    <td style="color: #facc15; font-weight: bold;">MEDIUM DEMAND</td>
                                    <td>Stick to your number</td>
                                    <td>Calculate max bid normally. Don't stretch. Pass if over.</td>
                                </tr>
                                <tr style="background: rgba(233, 69, 96, 0.2);">
                                    <td style="color: #e94560; font-weight: bold;">LOW DEMAND</td>
                                    <td>Must be under max bid</td>
                                    <td>Only buy if significantly under max bid. Cold inventory = extra caution.</td>
                                </tr>
                            </table>
                        </div>

                        <div class="lesson-section">
                            <h3>The Golden Rules of Demand</h3>
                            <div class="highlight-box" style="border: 2px solid #4ade80; padding: 25px;">
                                <ol style="font-size: 1.1em; line-height: 2.2;">
                                    <li><strong style="color: #4ade80;">We target DEMAND</strong> - it's our #1 priority</li>
                                    <li><strong>4WD sells, 2WD sits</strong> - book value adjusts, but demand doesn't</li>
                                    <li><strong>Crew Cab > Extended Cab</strong> - families need back seats</li>
                                    <li><strong>Popular trims move fast</strong> - WT/base models don't</li>
                                    <li><strong>Neutral colors sell</strong> - unusual colors limit buyers</li>
                                    <li><strong>High demand = can stretch</strong> - fast sale offsets slight overpay</li>
                                    <li><strong>Low demand = stick to number</strong> - sitting costs money</li>
                                    <li><strong>Time is money</strong> - floor plan + capital tie-up kills profit</li>
                                    <li><strong>A fast nickel beats a slow dime</strong> - target movers</li>
                                </ol>
                            </div>
                        </div>

                        <div class="lesson-section">
                            <h3>Quick Reference: Demand Indicators</h3>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                                <div class="highlight-box" style="background: #0a1a0a; border-color: #4ade80;">
                                    <h4 style="color: #4ade80;">HIGH DEMAND (HOT)</h4>
                                    <ul>
                                        <li>4WD / 4x4</li>
                                        <li>Crew Cab</li>
                                        <li>LT / SLT / Lariat / Big Horn</li>
                                        <li>5.5' or 6.5' bed</li>
                                        <li>White, Black, Silver, Gray</li>
                                        <li>V8, EcoBoost, Diesel</li>
                                    </ul>
                                </div>
                                <div class="warning-box" style="border-color: #e94560;">
                                    <h4 style="color: #e94560;">LOW DEMAND (COLD)</h4>
                                    <ul>
                                        <li>2WD / RWD</li>
                                        <li>Extended / Regular Cab</li>
                                        <li>Work Truck / Base</li>
                                        <li>8' long bed</li>
                                        <li>Bright Red, Yellow, Orange</li>
                                        <li>Base V6 in full-size</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div class="key-point">
                            <h3 style="color: #4ade80;">REMEMBER:</h3>
                            <p style="font-size: 1.3em;">Your profit is made when you buy AND when you sell. High demand = fast sale = realized profit. Low demand = sitting = fees eating your margin. <strong>TARGET DEMAND!</strong></p>
                        </div>
                    `
                }
            ],
            quiz: {
                id: 'quiz-10',
                title: 'Understanding Demand Quiz',
                questions: [
                    {
                        question: 'What is our #1 priority when buying vehicles?',
                        options: [
                            'Finding the lowest price',
                            'Targeting DEMAND - vehicles that sell fast',
                            'Only buying trucks with 0 accidents',
                            'Getting the highest CR grade'
                        ],
                        correct: 1,
                        explanation: 'We target DEMAND. A vehicle that sells fast means less floor plan fees, faster capital turnover, and realized profit. Price matters, but demand matters more.'
                    },
                    {
                        question: 'A 2WD truck has the same Black Book value as a 4WD. Why is 2WD still a problem?',
                        options: [
                            'Book value is wrong for 2WD',
                            '2WD trucks need more repairs',
                            '2WD = LOW DEMAND = sits longer = more floor plan fees = eats profit',
                            '2WD trucks are harder to drive'
                        ],
                        correct: 2,
                        explanation: 'Book value already adjusts for 2WD. The real problem is DEMAND. 2WD trucks sit 60-90 days while 4WD sells in 25-35 days. That extra time on lot costs you money in floor plan fees and ties up your capital.'
                    },
                    {
                        question: 'When can you "stretch" on price (go slightly over max bid)?',
                        options: [
                            'Never - always stick to max bid',
                            'When the vehicle has a clean history',
                            'When it is HIGH DEMAND (4WD, Crew Cab) - fast sale offsets slight overpay',
                            'When the seller offers financing'
                        ],
                        correct: 2,
                        explanation: 'High demand vehicles sell fast, so a slight overpay ($500-1,000) is offset by lower floor plan fees and faster capital turnover. Don\'t stretch on low demand vehicles - they will sit and eat your profit.'
                    },
                    {
                        question: 'Which configuration is HIGH DEMAND?',
                        options: [
                            '2020 Silverado LT Crew Cab 4x4 White',
                            '2019 Sierra SLT Extended Cab 2WD Silver',
                            '2018 F-150 XL Regular Cab 2WD Yellow',
                            '2021 Ram 1500 Tradesman Regular Cab 4WD 8\' Bed'
                        ],
                        correct: 0,
                        explanation: 'The 2020 Silverado LT Crew Cab 4x4 White hits all the high demand marks: 4WD, Crew Cab, mid-tier trim (LT), and neutral color (White). This will sell fast.'
                    },
                    {
                        question: 'A truck sits on the lot for 90 days instead of 30 days. What extra cost does this add?',
                        options: [
                            'No extra cost',
                            '~$300 in extra floor plan fees',
                            '~$150 in extra floor plan fees',
                            'Only affects paint condition'
                        ],
                        correct: 1,
                        explanation: '60 extra days at ~$5/day = ~$300 in extra floor plan fees. Plus your capital is tied up and can\'t be used for other deals. This is why demand matters!'
                    }
                ]
            }
        }
    ]
};
