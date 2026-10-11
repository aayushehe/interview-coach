bill=float(input("enter total bill: "))
people=int(input("enter no of people: "))
tip=float(input("enter tip percentage: "))

totalbill= bill+((bill*tip)/100)
per_person=totalbill/people
print(totalbill)
print(per_person)