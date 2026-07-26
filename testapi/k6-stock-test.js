import http from 'k6/http';
import { check, sleep } from 'k6';

// ტესტის კონფიგურაცია
export const options = {
  vus: 50,          // 50 მომხმარებელი ერთდროულად
  duration: '3s',   // 3 წამის განმავლობაში
};

export default function () {
  const url = 'http://localhost:5000/api/payments';



  // Marlboro პროდუქტის მონაცემები (ID: 1)
  const payload = JSON.stringify({
    items: [
      {
        productId: 1,
        quantity: 1,
        price: 7
      }
    ]
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      // თქვენი რეალური ავტორიზაციის ტოკენი სქრინშოტიდან:
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsImroleI6IkFETUlOIiwiaWF0IjoxNzQ4NzA5NTAwLCJleHAiOjE3NDg3OTU5MDB9.y6QJDf4r5WVvVV7R3RkurW0XlhvNeregePszun96Qwg',
    },
  };

  // ვაგზავნით მოთხოვნას
  const res = http.post(url, payload, params);
  console.log("სერვერის პასუხის სტატუსი: " + res.status + " | ტექსტი: " + res.body);

  // ვალიდაცია: სერვერმა უნდა დააბრუნოს ან 201 (წარმატება) ან 400 (მარაგი არ არის)
  check(res, {
    'სერვერი არ აგდებს 500 შეცდომას': (r) => r.status === 201 || r.status === 400,
    'წარმატებული ყიდვა (201)': (r) => r.status === 201,
    'უარი მარაგის გამო (400)': (r) => r.status === 400,
  });

  sleep(0.1);
}
